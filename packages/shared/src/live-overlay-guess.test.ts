import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeMaxBuy } from "./max-buy";
import {
  LIVE_OVERLAY_REFERENCE_SOURCE,
  emptyLiveOverlayGuess,
  isStableLiveIdentity,
  liveOverlayGuessFromSources,
} from "./live-overlay-guess";
import { identifyLiveVideo, mockLiveVideoFrame } from "./live-video-identity";
import { createMockTcgdexCatalogProvider } from "./catalog";
import { createMockPricingProvider, PRICE_ESTIMATE_REFERENCE_SOURCE } from "./pricing";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("live overlay guess from catalog + estimate", () => {
  it("builds a safe DTO with display Max Buy and no cardflow id", async () => {
    const catalog = createMockTcgdexCatalogProvider();
    const pricing = createMockPricingProvider();
    const card = await catalog.getCardById("base1-58", "en");
    const estimate = await pricing.getEstimate({ tcgdexId: "base1-58" });
    const expectedMaxBuy = computeMaxBuy({ referencePriceAmount: estimate.amount });

    const guess = liveOverlayGuessFromSources({
      tcgdexId: "base1-58",
      confidence: "High",
      catalogCard: card,
      estimate,
    });

    expect(guess).toMatchObject({
      tcgdexId: "base1-58",
      name: "Pikachu",
      setName: "Base Set",
      number: "58",
      estimateCents: 825,
      estimateAmount: "8.25",
      maxBuyAmount: expectedMaxBuy.maxBuyAmount,
      maxBuyAmountCents: expectedMaxBuy.maxBuyAmountCents,
      confidence: "High",
      referenceSource: PRICE_ESTIMATE_REFERENCE_SOURCE,
      currency: "USD",
      notConfirmed: true,
      writesInventory: false,
    });
    expect(LIVE_OVERLAY_REFERENCE_SOURCE).toBe("tcgdex_via_pokecollector");
    expect(guess?.imageUrl).toBe("https://assets.tcgdex.net/en/base/base1/58/high.webp");
    expect(JSON.stringify(guess)).not.toMatch(/cardflowCardId|cardflow_card_id/);
    expect(JSON.stringify(guess)).not.toMatch(/"pricing"\s*:/);
    expect(JSON.stringify(guess)).not.toContain("price_tcg");
  });

  it("returns null estimate and Max Buy when pricing is empty", () => {
    const guess = liveOverlayGuessFromSources({
      tcgdexId: "base1-58",
      confidence: "Medium",
    });
    expect(guess).toMatchObject({
      tcgdexId: "base1-58",
      name: null,
      estimateCents: null,
      maxBuyAmount: null,
      referenceSource: "none",
      writesInventory: false,
    });
    expect(emptyLiveOverlayGuess("base1-58").estimateDisplay).toBe("No estimate");
  });

  it("never invents a catalog id", () => {
    expect(liveOverlayGuessFromSources({ tcgdexId: "not a card" })).toBeNull();
    expect(
      isStableLiveIdentity(
        identifyLiveVideo({
          scannerOn: true,
          platform: "ios",
          frame: mockLiveVideoFrame("base1-58"),
          classifier: "mock",
        }),
      ),
    ).toBe(true);
    expect(
      isStableLiveIdentity(
        identifyLiveVideo({
          scannerOn: true,
          platform: "ios",
          frame: null,
          classifier: "mock",
        }),
      ),
    ).toBe(false);
  });

  it("does not write CRM or PokéCollector collection from the live guess path", () => {
    const api = readRepoFile("apps/api/src/app.ts");
    const overlay = readRepoFile("apps/mobile/components/ui/screener-overlay.tsx");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const client = readRepoFile("apps/mobile/lib/api.ts");
    const routeStart = api.indexOf('app.get("/v1/livestream/guesses/:tcgdexId"');
    expect(routeStart).toBeGreaterThan(-1);
    const route = api.slice(routeStart, api.indexOf("app.post(\"/v1/sessions\"", routeStart));
    expect(route).toContain("liveOverlayGuessFromSources");
    expect(route).toContain("getPreferences");
    expect(route).toContain("identityHash");
    expect(route).toContain("matchRgbPhash");
    expect(route).not.toContain("saveScan");
    expect(route).not.toContain("saveInventoryItem");
    expect(route).not.toContain("addPurchased");
    expect(route).not.toContain("addWatchlist");
    expect(route).not.toContain("confirmScan");
    expect(client).toContain("/v1/livestream/guesses/");
    expect(client).toContain("/v1/livestream/identify");
    expect(client).toContain("identifyLivestreamFrame");
    expect(client).toContain("identityHash");
    expect(overlay).toContain("getLiveOverlayGuess");
    expect(overlay).not.toContain("savePurchased");
    expect(overlay).toContain("I bought this");
    expect(scanTab).toContain("saveLivestreamPurchase");
    expect(scanTab).toContain("PurchaseSheet");
  });
});
