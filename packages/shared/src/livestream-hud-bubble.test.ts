import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRICE_ESTIMATE_REFERENCE_SOURCE } from "./pricing";
import {
  LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT,
  LIVESTREAM_HUD_BUBBLE_HEIGHT,
  LIVESTREAM_HUD_BUBBLE_INSET,
  LIVESTREAM_HUD_BUBBLE_WIDTH,
  LIVESTREAM_HUD_POSITION_KEY,
  clampLivestreamHudBubbleOffset,
  defaultLivestreamHudSavedPosition,
  liveHudListingUrl,
  liveHudPricesFromMatch,
  livestreamHudBubbleSize,
  livestreamHudOffsetFromSaved,
  parseLivestreamHudPosition,
  serializeLivestreamHudPosition,
  snapLivestreamHudBubbleOffset,
} from "./livestream-hud-bubble";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Livestream HUD snap and clamp", () => {
  it("sizes a rounded card, not a circle", () => {
    expect(livestreamHudBubbleSize(false)).toEqual({
      width: LIVESTREAM_HUD_BUBBLE_WIDTH,
      height: LIVESTREAM_HUD_BUBBLE_HEIGHT,
    });
    expect(livestreamHudBubbleSize(true)).toEqual({
      width: LIVESTREAM_HUD_BUBBLE_WIDTH,
      height: LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT,
    });
    expect(LIVESTREAM_HUD_BUBBLE_WIDTH).toBeGreaterThan(LIVESTREAM_HUD_BUBBLE_HEIGHT);
  });

  it("clamps inside the live region and safe-area insets", () => {
    expect(
      clampLivestreamHudBubbleOffset({
        x: -40,
        y: -12,
        parentWidth: 390,
        parentHeight: 700,
        bubbleWidth: LIVESTREAM_HUD_BUBBLE_WIDTH,
        bubbleHeight: LIVESTREAM_HUD_BUBBLE_HEIGHT,
        safeTop: 8,
        safeLeft: 4,
      }),
    ).toEqual({
      x: LIVESTREAM_HUD_BUBBLE_INSET + 4,
      y: LIVESTREAM_HUD_BUBBLE_INSET + 8,
    });

    expect(
      clampLivestreamHudBubbleOffset({
        x: 800,
        y: 800,
        parentWidth: 390,
        parentHeight: 700,
        bubbleWidth: LIVESTREAM_HUD_BUBBLE_WIDTH,
        bubbleHeight: LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT,
        safeBottom: 20,
        safeRight: 6,
      }),
    ).toEqual({
      x: 390 - LIVESTREAM_HUD_BUBBLE_WIDTH - LIVESTREAM_HUD_BUBBLE_INSET - 6,
      y: 700 - LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT - LIVESTREAM_HUD_BUBBLE_INSET - 20,
    });
  });

  it("snaps a released drag to the nearest left or right edge", () => {
    const left = snapLivestreamHudBubbleOffset({
      x: 40,
      y: 180,
      parentWidth: 390,
      parentHeight: 700,
      bubbleWidth: LIVESTREAM_HUD_BUBBLE_WIDTH,
      bubbleHeight: LIVESTREAM_HUD_BUBBLE_HEIGHT,
    });
    expect(left.edge).toBe("left");
    expect(left.x).toBe(LIVESTREAM_HUD_BUBBLE_INSET);
    expect(left.y).toBe(180);

    const right = snapLivestreamHudBubbleOffset({
      x: 200,
      y: 20,
      parentWidth: 390,
      parentHeight: 700,
      bubbleWidth: LIVESTREAM_HUD_BUBBLE_WIDTH,
      bubbleHeight: LIVESTREAM_HUD_BUBBLE_HEIGHT,
    });
    expect(right.edge).toBe("right");
    expect(right.x).toBe(390 - LIVESTREAM_HUD_BUBBLE_WIDTH - LIVESTREAM_HUD_BUBBLE_INSET);
    expect(right.y).toBe(20);
  });

  it("restores a saved edge and clamps Y into the safe area", () => {
    const restored = livestreamHudOffsetFromSaved({
      position: { edge: "right", y: 900 },
      parentWidth: 390,
      parentHeight: 700,
      bubbleWidth: LIVESTREAM_HUD_BUBBLE_WIDTH,
      bubbleHeight: LIVESTREAM_HUD_BUBBLE_HEIGHT,
      safeBottom: 10,
    });
    expect(restored.edge).toBe("right");
    expect(restored.x).toBe(390 - LIVESTREAM_HUD_BUBBLE_WIDTH - LIVESTREAM_HUD_BUBBLE_INSET);
    expect(restored.y).toBe(700 - LIVESTREAM_HUD_BUBBLE_HEIGHT - LIVESTREAM_HUD_BUBBLE_INSET - 10);
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

describe("Livestream HUD saved position", () => {
  it("round-trips a snapped edge through the existing local-storage key", () => {
    expect(defaultLivestreamHudSavedPosition()).toEqual({
      edge: "right",
      y: LIVESTREAM_HUD_BUBBLE_INSET,
    });
    expect(parseLivestreamHudPosition("not-json")).toBeNull();
    expect(parseLivestreamHudPosition(serializeLivestreamHudPosition({ edge: "left", y: 64 }))).toEqual({
      edge: "left",
      y: 64,
    });

    const positionLib = readRepoFile("apps/mobile/lib/live-hud-position.ts");
    expect(positionLib).toContain("expo-secure-store");
    expect(positionLib).toContain("LIVESTREAM_HUD_POSITION_KEY");
    expect(positionLib).toContain("SecureStore.setItemAsync");
    expect(positionLib).not.toContain("AsyncStorage");
  });
});

describe("Livestream HUD bubble chrome", () => {
  it("is a dedicated card above the RN live page, never a Capgo overlay or bid script", () => {
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
    expect(bubble).toContain("pointerEvents=\"box-none\"");
    expect(bubble).toContain(">Raw<");
    expect(bubble).toContain("PSA 9");
    expect(bubble).toContain("PSA 10");
    expect(bubble).not.toMatch(/powered by|brickify|poketrace/i);
    expect(bubble).toContain("Buy");
    expect(bubble).not.toContain("placeBid");
    expect(scanTab).toContain("LivestreamBrowser");
    expect(scanTab).toContain("<ScreenerOverlay");
    expect(scanTab.indexOf("<LivestreamBrowser")).toBeLessThan(scanTab.indexOf("<ScreenerOverlay"));
    expect(scanTab).toContain('pointerEvents="box-none"');
    expect(scanTab).not.toContain("saveLivestreamPurchase");
    expect(browser).toContain('return "unavailable"');
    expect(browser).toContain("draws over React Native siblings");
    expect(liveBrowser).toContain("isCapgoLivestreamBrowserAvailable");
    expect(listing).toContain("openBrowserAsync");
    expect(listing).not.toMatch(/placeBid|executeScript|injectJavaScript/);
  });
});
