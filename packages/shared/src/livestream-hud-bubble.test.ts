import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOCKED_DISPLAY_CURRENCY } from "./max-buy";
import { PRICE_ESTIMATE_REFERENCE_SOURCE } from "./pricing";
import {
  LIVE_HUD_QUICK_SAVE_ZERO,
  LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT,
  LIVESTREAM_HUD_BUBBLE_HEIGHT,
  LIVESTREAM_HUD_BUBBLE_INSET,
  LIVESTREAM_HUD_POSITION_KEY,
  clampLivestreamHudBubbleOffset,
  defaultLivestreamHudSavedPosition,
  liveHudListingUrl,
  liveHudPricesFromMatch,
  liveHudPurchasePriceFromMatch,
  liveHudQuickSavePayload,
  livestreamHudBubbleSize,
  livestreamHudBubbleWidth,
  livestreamHudOffsetFromSaved,
  parseLivestreamHudPosition,
  serializeLivestreamHudPosition,
  snapLivestreamHudBubbleOffset,
} from "./livestream-hud-bubble";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PAGE_SCRAPE = /whatnot|querySelector|innerHTML|executeScript|injectJavaScript|scrape/i;

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const FULL_WIDTH = livestreamHudBubbleWidth({ parentWidth: 390 });

describe("Livestream HUD snap and clamp", () => {
  it("sizes a full-width bar inside the safe area", () => {
    expect(livestreamHudBubbleSize(false, { parentWidth: 390 })).toEqual({
      width: 390 - LIVESTREAM_HUD_BUBBLE_INSET * 2,
      height: LIVESTREAM_HUD_BUBBLE_HEIGHT,
    });
    expect(livestreamHudBubbleSize(true, { parentWidth: 390, safeLeft: 4, safeRight: 6 })).toEqual({
      width: 390 - LIVESTREAM_HUD_BUBBLE_INSET * 2 - 4 - 6,
      height: LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT,
    });
    expect(FULL_WIDTH).toBeGreaterThan(LIVESTREAM_HUD_BUBBLE_HEIGHT);
  });

  it("clamps inside the live region and safe-area insets", () => {
    expect(
      clampLivestreamHudBubbleOffset({
        x: -40,
        y: -12,
        parentWidth: 390,
        parentHeight: 700,
        bubbleWidth: FULL_WIDTH,
        bubbleHeight: LIVESTREAM_HUD_BUBBLE_HEIGHT,
        safeTop: 8,
        safeLeft: 4,
      }),
    ).toEqual({
      x: LIVESTREAM_HUD_BUBBLE_INSET + 4,
      y: LIVESTREAM_HUD_BUBBLE_INSET + 8,
    });

    const fittedWidth = livestreamHudBubbleWidth({ parentWidth: 390, safeRight: 6 });
    expect(
      clampLivestreamHudBubbleOffset({
        x: 800,
        y: 800,
        parentWidth: 390,
        parentHeight: 700,
        bubbleWidth: fittedWidth,
        bubbleHeight: LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT,
        safeBottom: 20,
        safeRight: 6,
      }),
    ).toEqual({
      x: LIVESTREAM_HUD_BUBBLE_INSET,
      y: 700 - LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT - LIVESTREAM_HUD_BUBBLE_INSET - 20,
    });
  });

  it("snaps a released vertical drag to the nearest top or bottom edge", () => {
    const top = snapLivestreamHudBubbleOffset({
      x: 40,
      y: 80,
      parentWidth: 390,
      parentHeight: 700,
      bubbleWidth: FULL_WIDTH,
      bubbleHeight: LIVESTREAM_HUD_BUBBLE_HEIGHT,
    });
    expect(top.edge).toBe("top");
    expect(top.x).toBe(LIVESTREAM_HUD_BUBBLE_INSET);
    expect(top.y).toBe(LIVESTREAM_HUD_BUBBLE_INSET);

    const bottom = snapLivestreamHudBubbleOffset({
      x: 20,
      y: 500,
      parentWidth: 390,
      parentHeight: 700,
      bubbleWidth: FULL_WIDTH,
      bubbleHeight: LIVESTREAM_HUD_BUBBLE_HEIGHT,
    });
    expect(bottom.edge).toBe("bottom");
    expect(bottom.x).toBe(LIVESTREAM_HUD_BUBBLE_INSET);
    expect(bottom.y).toBe(700 - LIVESTREAM_HUD_BUBBLE_HEIGHT - LIVESTREAM_HUD_BUBBLE_INSET);
  });

  it("restores a saved top or bottom edge and ignores leftover left/right saves", () => {
    const restored = livestreamHudOffsetFromSaved({
      position: { edge: "bottom" },
      parentWidth: 390,
      parentHeight: 700,
      bubbleWidth: FULL_WIDTH,
      bubbleHeight: LIVESTREAM_HUD_BUBBLE_HEIGHT,
      safeBottom: 10,
    });
    expect(restored.edge).toBe("bottom");
    expect(restored.x).toBe(LIVESTREAM_HUD_BUBBLE_INSET);
    expect(restored.y).toBe(700 - LIVESTREAM_HUD_BUBBLE_HEIGHT - LIVESTREAM_HUD_BUBBLE_INSET - 10);

    expect(parseLivestreamHudPosition(JSON.stringify({ edge: "right", y: 64 }))).toEqual({
      edge: "top",
    });
  });
});

describe("Livestream HUD match prices and listing", () => {
  it("fills Raw only from allowed match sources and leaves PSA slots empty otherwise", () => {
    expect(liveHudPricesFromMatch(null)).toEqual({
      rawAmount: null,
      psa9Amount: null,
      psa10Amount: null,
    });
    expect(
      liveHudPricesFromMatch({
        estimateAmount: "8.25",
        referenceSource: "none",
      }),
    ).toEqual({ rawAmount: null, psa9Amount: null, psa10Amount: null });
    expect(
      liveHudPricesFromMatch({
        estimateAmount: "8.25",
        psa9Amount: "55.00",
        psa10Amount: "120.40",
        referenceSource: PRICE_ESTIMATE_REFERENCE_SOURCE,
      }),
    ).toEqual({
      rawAmount: "$8.25",
      psa9Amount: "$55.00",
      psa10Amount: "$120.40",
    });
  });

  it("opens an https listing from match identity and rejects scripted bid URLs", () => {
    expect(liveHudListingUrl(null)).toBeNull();
    expect(
      liveHudListingUrl({
        listingUrl: "javascript:placeBid()",
        name: "Pikachu",
        number: "58",
        setName: "Base Set",
      }),
    ).toBe(
      "https://www.tcgplayer.com/search/pokemon/product?q=Pikachu%2058%20Base%20Set&view=grid&ProductTypeName=Cards",
    );
    expect(liveHudListingUrl({ listingUrl: "https://www.tcgplayer.com/product/123" })).toBe(
      "https://www.tcgplayer.com/product/123",
    );
  });
});

describe("Livestream HUD quick-save defaults", () => {
  it("saves USD now with zero add-ons and a local purchase_price only", () => {
    expect(liveHudPurchasePriceFromMatch(null)).toBeNull();
    expect(
      liveHudPurchasePriceFromMatch({
        estimateAmount: "8.25",
        referenceSource: "none",
      }),
    ).toBeNull();
    expect(
      liveHudPurchasePriceFromMatch({
        estimateAmount: "8.25",
        referenceSource: PRICE_ESTIMATE_REFERENCE_SOURCE,
      }),
    ).toBe("8.25");

    const missing = liveHudQuickSavePayload({ match: { estimateAmount: "8.25", referenceSource: "none" } });
    expect(missing).toEqual({ ok: false, reason: "purchase_price_required" });

    const saved = liveHudQuickSavePayload({
      match: { estimateAmount: "$8.25", referenceSource: PRICE_ESTIMATE_REFERENCE_SOURCE },
      now: () => "2026-10-11T22:30:00.000Z",
    });
    expect(saved).toEqual({
      ok: true,
      payload: {
        purchasePrice: "8.25",
        purchasedAt: "2026-10-11T22:30:00.000Z",
        currency: LOCKED_DISPLAY_CURRENCY,
        shipping: LIVE_HUD_QUICK_SAVE_ZERO,
        tax: LIVE_HUD_QUICK_SAVE_ZERO,
        fees: LIVE_HUD_QUICK_SAVE_ZERO,
        supplies: LIVE_HUD_QUICK_SAVE_ZERO,
      },
    });
    expect(LOCKED_DISPLAY_CURRENCY).toBe("USD");
    expect(LIVE_HUD_QUICK_SAVE_ZERO).toBe("0.00");

    const typed = liveHudQuickSavePayload({
      purchasePrice: "12.50",
      now: () => "2026-10-11T22:31:00.000Z",
    });
    expect(typed).toMatchObject({
      ok: true,
      payload: { purchasePrice: "12.50", shipping: "0.00", fees: "0.00" },
    });
  });

  it("never reads or scrapes the live page for fees, shipping, or prices", () => {
    const helper = readRepoFile("packages/shared/src/livestream-hud-bubble.ts");
    const bubble = readRepoFile("apps/mobile/components/ui/live-hud-bubble.tsx");
    const overlay = readRepoFile("apps/mobile/components/ui/screener-overlay.tsx");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const listing = readRepoFile("apps/mobile/lib/live-hud-listing.ts");
    for (const source of [helper, bubble, overlay, scanTab, listing]) {
      expect(source).not.toMatch(PAGE_SCRAPE);
    }
  });
});

describe("Livestream HUD saved position", () => {
  it("round-trips a snapped top or bottom edge through the existing local-storage key", () => {
    expect(defaultLivestreamHudSavedPosition()).toEqual({
      edge: "top",
    });
    expect(parseLivestreamHudPosition("not-json")).toBeNull();
    expect(parseLivestreamHudPosition(serializeLivestreamHudPosition({ edge: "bottom" }))).toEqual({
      edge: "bottom",
    });

    const positionLib = readRepoFile("apps/mobile/lib/live-hud-position.ts");
    expect(positionLib).toContain("expo-secure-store");
    expect(positionLib).toContain("LIVESTREAM_HUD_POSITION_KEY");
    expect(positionLib).toContain("SecureStore.setItemAsync");
    expect(positionLib).not.toContain("AsyncStorage");
  });
});

describe("Livestream HUD bubble chrome", () => {
  it("is a dedicated full-width card above the RN live page, never a Capgo overlay or bid script", () => {
    const bubble = readRepoFile("apps/mobile/components/ui/live-hud-bubble.tsx");
    const overlay = readRepoFile("apps/mobile/components/ui/screener-overlay.tsx");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const browser = readRepoFile("apps/mobile/lib/in-app-browser.ts");
    const liveBrowser = readRepoFile("apps/mobile/components/ui/livestream-browser.tsx");
    const listing = readRepoFile("apps/mobile/lib/live-hud-listing.ts");

    expect(overlay).toContain("from \"@/components/ui/live-hud-bubble\"");
    expect(overlay).toContain("<LiveHudBubble");
    expect(bubble).toContain("GestureDetector");
    expect(bubble).toContain("react-native-reanimated");
    expect(bubble).toContain("FadeInDown");
    expect(bubble).toContain("snapLivestreamHudBubbleOffset");
    expect(bubble).toContain("livestreamHudBubbleWidth");
    expect(bubble).toContain("pointerEvents=\"box-none\"");
    expect(bubble).toContain('label="Raw"');
    expect(bubble).toContain("PSA 9");
    expect(bubble).toContain("PSA 10");
    expect(bubble).not.toMatch(/powered by|brickify|poketrace/i);
    expect(bubble).toContain("Purchased");
    expect(bubble).toContain("Add details");
    expect(bubble).toContain("liveHudQuickSavePayload");
    expect(bubble).not.toContain("I bought this");
    expect(bubble).not.toMatch(/>Buy</);
    expect(bubble).not.toContain("placeBid");
    expect(scanTab).toContain("LivestreamBrowser");
    expect(scanTab).toContain("<ScreenerOverlay");
    expect(scanTab.indexOf("<LivestreamBrowser")).toBeLessThan(scanTab.indexOf("<ScreenerOverlay"));
    expect(scanTab).toContain('pointerEvents="box-none"');
    expect(scanTab).toContain("saveLivestreamPurchase");
    expect(scanTab).toContain("PurchaseSheet");
    expect(browser).toContain('return "unavailable"');
    expect(browser).toContain("draws over React Native siblings");
    expect(liveBrowser).toContain("isCapgoLivestreamBrowserAvailable");
    expect(listing).toContain("openBrowserAsync");
    expect(listing).not.toMatch(/placeBid|executeScript|injectJavaScript/);
  });
});
