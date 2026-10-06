import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectionTileValue,
  computeMaxBuy,
  DEFAULT_MAX_BUY_PREFERENCES,
  MAX_BUY_NOT_MARKET_PRICE_DISCLAIMER,
  recomputeCopyMaxBuy,
} from "./max-buy";
import type { MaxBuyPreferences } from "./types";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const tighterMargin: MaxBuyPreferences = {
  ...DEFAULT_MAX_BUY_PREFERENCES,
  targetMarginPct: 0.3,
};

describe("recompute Max Buy from current prefs + stored reference", () => {
  it("changes guidance when margin changes and the stored reference stays $8.00", () => {
    const stored = { referencePriceAmount: "8.00", condition: "NM" };
    const before = recomputeCopyMaxBuy(stored, DEFAULT_MAX_BUY_PREFERENCES);
    const after = recomputeCopyMaxBuy(stored, tighterMargin);

    expect(before.maxBuyAmount).toBe("5.57");
    expect(after.maxBuyAmount).toBe("4.87");
    expect(after.isRecomputedGuidance).toBe(true);
    expect(after.disclaimer).toBe(MAX_BUY_NOT_MARKET_PRICE_DISCLAIMER);
    expect(after.disclaimer).toContain("not a market price");
  });

  it("does not treat a frozen Max Buy snapshot as truth", () => {
    const frozenAtSave = computeMaxBuy({
      referencePriceAmount: "8.00",
      condition: "NM",
      preferences: DEFAULT_MAX_BUY_PREFERENCES,
    }).maxBuyAmount;

    expect(frozenAtSave).toBe("5.57");
    expect(
      recomputeCopyMaxBuy(
        { referencePriceAmount: "8.00", condition: "NM" },
        tighterMargin,
      ).maxBuyAmount,
    ).not.toBe(frozenAtSave);
  });

  it("watchlist tiles recompute target Max Buy; purchased tiles stay all-in", () => {
    const watchlistAfterSave = collectionTileValue(
      {
        intent: "watchlist",
        referencePriceAmount: "8.00",
        allInTotal: null,
      },
      tighterMargin,
    );
    const purchased = collectionTileValue(
      {
        intent: "purchased",
        referencePriceAmount: "8.00",
        allInTotal: "4.04",
      },
      tighterMargin,
    );

    expect(watchlistAfterSave).toEqual({
      allInAmount: null,
      targetMaxBuyDisplay: "$4.87",
    });
    expect(purchased).toEqual({
      allInAmount: "4.04",
      targetMaxBuyDisplay: null,
    });
  });

  it("uses the condition Decide saved so the watchlist tile matches that Max Buy", () => {
    const preferences: MaxBuyPreferences = {
      ...DEFAULT_MAX_BUY_PREFERENCES,
      conditionAdjustments: { NM: 1, LP: 0.85 },
    };
    const shown = computeMaxBuy({
      referencePriceAmount: "8.00",
      condition: "LP",
      preferences,
    });
    const tile = collectionTileValue(
      {
        intent: "watchlist",
        referencePriceAmount: "8.00",
        condition: "LP",
      },
      preferences,
    );
    const withoutCondition = collectionTileValue(
      {
        intent: "watchlist",
        referencePriceAmount: "8.00",
        condition: null,
      },
      preferences,
    );

    expect(tile.targetMaxBuyDisplay).toBe(`$${shown.maxBuyAmount}`);
    expect(tile.targetMaxBuyDisplay).not.toBe(withoutCondition.targetMaxBuyDisplay);
  });
});

describe("Detail, Watchlist, and Purchased surfaces recompute after Save", () => {
  it("Detail peeks the last successful PATCH cache on focus, then GET", () => {
    const screen = readRepoFile("apps/mobile/app/decide/[cardflowCardId].tsx");
    const focusStart = screen.indexOf("useFocusEffect");
    const peek = screen.indexOf("setPreferences(peekMaxBuyPreferences())", focusStart);
    const load = screen.indexOf("loadMaxBuyPreferences()", focusStart);

    expect(screen).toContain("computeMaxBuy");
    expect(screen).toContain("CONDITION_LABELS");
    expect(screen).toContain("condition,");
    expect(screen).not.toContain('condition: "NM"');
    expect(screen).toContain("maxBuy.disclaimer");
    expect(peek).toBeGreaterThan(focusStart);
    expect(load).toBeGreaterThan(peek);
    expect(MAX_BUY_NOT_MARKET_PRICE_DISCLAIMER).toContain("not a market price");
  });

  it("Watchlist tiles use current prefs + stored reference, not targetMaxBuyAmount", () => {
    const collection = readRepoFile("apps/mobile/app/(tabs)/collection.tsx");
    expect(collection).toContain("collectionTileValue");
    expect(collection).toContain("item.referencePriceAmount");
    expect(collection).toContain("condition: item.condition");
    expect(collection).toContain("loadMaxBuyPreferences");
    expect(collection).not.toMatch(/item\.targetMaxBuyAmount \? `\$\{item\.targetMaxBuyAmount\}`/);
  });

  it("API overlays live guidance on GET and does not rewrite inventory on PATCH", () => {
    const api = readRepoFile("apps/api/src/app.ts");
    const patchStart = api.indexOf('app.patch("/v1/preferences"');
    const patchEnd = api.indexOf("app.post", patchStart);
    const patch = api.slice(patchStart, patchEnd);
    const list = api.slice(
      api.indexOf('app.get("/v1/inventory"'),
      api.indexOf('app.get("/v1/inventory/:inventoryItemId"'),
    );

    expect(list).toContain("inventoryItemWithLiveGuidance");
    expect(api).toContain("referencePriceAmount: maxBuy.referencePriceAmount");
    expect(patch).toContain("setPreferences(userId, next)");
    expect(patch).not.toContain("updateInventoryItem");
    expect(patch).not.toContain("saveInventoryItem");

    const watchlist = api.slice(
      api.indexOf('app.post("/v1/inventory/watchlist"'),
      api.indexOf('app.post("/v1/inventory/:inventoryItemId/drafts"'),
    );
    expect(watchlist).toContain("body.condition");
    expect(watchlist).toContain("condition,");
    expect(watchlist).not.toContain("condition: null");
    const saveWatchlist = readRepoFile("apps/mobile/lib/api.ts");
    expect(saveWatchlist).toContain("condition?: string | null");
  });

  it("card tiles still show all-in for purchased copies", () => {
    const tile = readRepoFile("apps/mobile/components/ui/card-tile.tsx");
    const valueLabel = tile.slice(tile.indexOf("const valueLabel"));
    expect(valueLabel).toContain("target Max Buy");
    expect(valueLabel).toContain("all-in $");
    expect(valueLabel.indexOf('intent === "watchlist"')).toBeLessThan(
      valueLabel.indexOf("`all-in $"),
    );
  });
});
