import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeCostToAskSpread } from "./listing-draft";
import { collectionTileValue, DEFAULT_MAX_BUY_PREFERENCES } from "./max-buy";
import {
  DETAILS_NEEDED_DEBOUNCE_MS,
  DETAILS_NEEDED_LABEL,
  DETAILS_NEEDED_WORKFLOW_STATE,
  detailsNeededCostBasis,
  isDetailsNeededPurchase,
  isRecentDetailsNeededDuplicate,
  livestreamContextTags,
  purchasedAllInAmount,
  sanitizeLivestreamUrl,
  shouldAcceptLiveHudPurchaseTap,
} from "./details-needed";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("details-needed Purchased state", () => {
  it("treats purchased + details_needed as incomplete with empty cost fields", () => {
    const cost = detailsNeededCostBasis();
    expect(cost.purchasePrice).toBeNull();
    expect(cost.allInTotal).toBeNull();
    expect(cost.purchasePrice).not.toBe("0.00");

    const incomplete = {
      intent: "purchased" as const,
      workflowState: DETAILS_NEEDED_WORKFLOW_STATE,
      purchase: { costBasis: cost },
      allInTotal: null,
    };
    expect(isDetailsNeededPurchase(incomplete)).toBe(true);
    expect(purchasedAllInAmount(incomplete)).toBeNull();
    expect(incomplete.purchase.costBasis.purchasePrice).toBeNull();
    expect(DETAILS_NEEDED_LABEL).toBe("Details needed");
    expect(
      collectionTileValue(
        { ...incomplete, allInTotal: null },
        DEFAULT_MAX_BUY_PREFERENCES,
      ),
    ).toEqual({ allInAmount: null, targetMaxBuyDisplay: null });
  });

  it("excludes details-needed copies from all-in totals and cost-to-ask spread", () => {
    const incomplete = {
      intent: "purchased" as const,
      workflowState: DETAILS_NEEDED_WORKFLOW_STATE,
      allInTotal: "12.00",
      purchase: { costBasis: { allInTotal: "12.00" } },
    };
    expect(purchasedAllInAmount(incomplete)).toBeNull();
    expect(
      computeCostToAskSpread({
        askingPrice: "20.00",
        allInTotal: purchasedAllInAmount(incomplete),
        workflowState: incomplete.workflowState,
      }),
    ).toBeNull();

    const complete = {
      intent: "purchased" as const,
      workflowState: "acquired",
      allInTotal: "12.00",
      purchase: { costBasis: { allInTotal: "12.00" } },
    };
    expect(isDetailsNeededPurchase(complete)).toBe(false);
    expect(purchasedAllInAmount(complete)).toBe("12.00");
    expect(
      collectionTileValue(complete, DEFAULT_MAX_BUY_PREFERENCES).allInAmount,
    ).toBe("12.00");
  });

  it("stores local stream context in tags and rejects scraped or scripted URLs", () => {
    expect(
      livestreamContextTags({
        platform: "whatnot",
        streamUrl: "https://www.whatnot.com",
      }),
    ).toEqual(["raw", "livestream", "livestream:whatnot", "livestream_url:https://www.whatnot.com/"]);
    expect(sanitizeLivestreamUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeLivestreamUrl("http://www.whatnot.com")).toBeNull();
    expect(livestreamContextTags({ platform: "etsy", streamUrl: "https://evil.example" })).toEqual([
      "raw",
      "livestream",
      "livestream_url:https://evil.example/",
    ]);
  });

  it("debounces a single match so rapid taps do not duplicate it", () => {
    expect(
      shouldAcceptLiveHudPurchaseTap({
        matchKey: "base1-58",
        inFlightKey: "base1-58",
      }),
    ).toBe(false);
    expect(
      shouldAcceptLiveHudPurchaseTap({
        matchKey: "base1-58",
        savedKeys: ["base1-58"],
      }),
    ).toBe(false);
    expect(
      shouldAcceptLiveHudPurchaseTap({
        matchKey: "base1-4",
        inFlightKey: "base1-58",
        savedKeys: ["base1-58"],
      }),
    ).toBe(true);

    expect(
      isRecentDetailsNeededDuplicate({
        existing: { cardflowCardId: "card-1", createdAt: "2026-10-11T22:00:00.000Z" },
        cardflowCardId: "card-1",
        nowMs: Date.parse("2026-10-11T22:00:04.000Z"),
      }),
    ).toBe(true);
    expect(
      isRecentDetailsNeededDuplicate({
        existing: { cardflowCardId: "card-1", createdAt: "2026-10-11T22:00:00.000Z" },
        cardflowCardId: "card-1",
        nowMs: Date.parse("2026-10-11T22:00:00.000Z") + DETAILS_NEEDED_DEBOUNCE_MS,
      }),
    ).toBe(false);
  });

  it("saves instantly from the HUD bubble and finishes details on the Purchased screen", () => {
    const overlay = readRepoFile("apps/mobile/components/ui/screener-overlay.tsx");
    const bubble = readRepoFile("apps/mobile/components/ui/hud-bubble.tsx");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const collection = readRepoFile("apps/mobile/app/(tabs)/collection.tsx");
    const tile = readRepoFile("apps/mobile/components/ui/card-tile.tsx");
    const api = readRepoFile("apps/api/src/app.ts");
    const client = readRepoFile("apps/mobile/lib/api.ts");

    expect(scanTab).toContain("saveLivestreamPurchase");
    expect(scanTab).toContain("streamUrl: chrome.pageUrl");
    expect(scanTab).not.toContain("PurchaseSheet");
    expect(overlay).toContain("HudBubble");
    expect(overlay).toContain("shouldAcceptLiveHudPurchaseTap");
    expect(overlay).toContain("Purchased");
    expect(overlay).not.toContain("I bought this");
    expect(overlay).not.toContain("Add details");
    expect(overlay).not.toContain("PurchaseSheet");
    expect(bubble).toContain("Drag CardFlow overlay");
    expect(bubble).not.toContain("live-hud-bubble");
    expect(collection).toContain("PurchaseSheet");
    expect(collection).toContain("DETAILS_NEEDED_LABEL");
    expect(collection).toContain("completePurchasedDetails");
    expect(tile).toContain("detailsNeeded");
    expect(api).toContain("detailsNeededCostBasis");
    expect(api).toContain("detailsNeeded");
    expect(api).toContain('app.post("/v1/inventory/:inventoryItemId/purchase"');
    expect(client).toContain("detailsNeeded: true");
    expect(client).toContain("/purchase");
  });
});
