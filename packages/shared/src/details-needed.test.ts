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
  PURCHASED_UNDO_ACTION_LABEL,
  PURCHASED_UNDO_TOAST_MESSAGE,
  PURCHASED_UNDO_TOAST_MS,
  WATCHLIST_CLOSED_WORKFLOW_STATE,
  WATCHLIST_SOURCE_TAG,
  detailsNeededCostBasis,
  isClosedWatchlist,
  isDetailsNeededPurchase,
  isOpenWatchlist,
  isRecentDetailsNeededDuplicate,
  livestreamContextTags,
  purchasedAllInAmount,
  sanitizeLivestreamUrl,
  shouldAcceptLiveHudPurchaseTap,
  watchlistConversionTags,
  watchlistSourceIdFromTags,
} from "./details-needed";
import { readApiSource, readApiClientSource } from "./repo-sources";

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
    const api = readApiSource();
    const client = readApiClientSource();

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

  it("shows a 5-second VoiceOver/TalkBack Undo toast and haptic instead of a confirm dialog", () => {
    const overlay = readRepoFile("apps/mobile/components/ui/screener-overlay.tsx");
    const bubble = readRepoFile("apps/mobile/components/ui/hud-bubble.tsx");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const purchase = readRepoFile("apps/mobile/components/ui/purchase-sheet.tsx");
    const client = readApiClientSource();
    const api = readApiSource();

    expect(PURCHASED_UNDO_TOAST_MS).toBe(5_000);
    expect(PURCHASED_UNDO_TOAST_MESSAGE).toBe("Marked Purchased · Undo");
    expect(PURCHASED_UNDO_ACTION_LABEL).toBe("Undo");

    expect(overlay).toContain("PurchasedUndoToast");
    expect(overlay).toContain("playPurchasedSuccessHaptic");
    expect(overlay).toContain("PURCHASED_UNDO_TOAST_MS");
    expect(overlay).toContain("announceForAccessibility");
    expect(overlay).not.toContain("Alert.alert");
    expect(overlay).not.toContain("PurchaseSheet");
    expect(overlay).not.toContain("pointerEvents=\"none\"");

    expect(bubble).toContain('from "expo-haptics"');
    expect(bubble).toContain("notificationAsync");
    expect(bubble).toContain("PurchasedUndoToast");
    expect(bubble).toContain("PURCHASED_UNDO_TOAST_MESSAGE");
    expect(bubble).toContain('accessibilityRole="alert"');
    expect(bubble).toContain("accessibilityLiveRegion");
    expect(bubble).toContain('accessibilityLabel={PURCHASED_UNDO_ACTION_LABEL}');
    expect(bubble).toContain('accessibilityRole="button"');
    expect(bubble).toContain("minHeight: 44");
    expect(bubble).not.toContain("Alert.alert");

    expect(scanTab).toContain("saveLivestreamPurchase");
    expect(scanTab).toContain("undoLivestreamPurchase");
    expect(scanTab).toContain("onUndoPurchased");
    expect(scanTab).not.toContain("PurchaseSheet");
    expect(scanTab).not.toContain("Alert.alert");

    expect(purchase).not.toContain("Alert.alert");
    expect(purchase).toContain("Livestream HUD one-tap Purchased never opens this");

    expect(client).toContain("undoLivestreamPurchase");
    expect(client).toContain("undoPurchased");
    expect(client).toContain('method: "DELETE"');
    expect(api).toContain('app.delete("/v1/inventory/:inventoryItemId"');
  });

  it("converts Watchlist to Purchased in one tap with identity and Max Buy, no rescan", () => {
    const collection = readRepoFile("apps/mobile/app/(tabs)/collection.tsx");
    const decide = readRepoFile("apps/mobile/app/decide/[cardflowCardId].tsx");
    const tile = readRepoFile("apps/mobile/components/ui/card-tile.tsx");
    const purchase = readRepoFile("apps/mobile/components/ui/purchase-sheet.tsx");
    const bubble = readRepoFile("apps/mobile/components/ui/hud-bubble.tsx");
    const client = readApiClientSource();
    const api = readApiSource();
    const convertStart = client.indexOf("export function convertWatchlistToPurchased");
    const convertClient = client.slice(convertStart, client.indexOf("\nexport ", convertStart + 1));

    expect(isOpenWatchlist({ intent: "watchlist", workflowState: "watching" })).toBe(true);
    expect(
      isClosedWatchlist({
        intent: "watchlist",
        workflowState: WATCHLIST_CLOSED_WORKFLOW_STATE,
      }),
    ).toBe(true);
    expect(watchlistConversionTags("wl-1")).toEqual([
      "raw",
      WATCHLIST_SOURCE_TAG,
      `${WATCHLIST_SOURCE_TAG}:wl-1`,
    ]);
    expect(watchlistSourceIdFromTags(watchlistConversionTags("wl-1"))).toBe("wl-1");

    expect(collection).toContain("convertWatchlistToPurchased");
    expect(collection).toContain("playPurchasedSuccessHaptic");
    expect(collection).toContain("PurchasedUndoToast");
    expect(collection).toContain("PURCHASED_UNDO_TOAST_MS");
    expect(collection).toContain("undoPurchased");
    expect(collection).toContain('accessibilityLabel="Purchased"');
    expect(collection).not.toContain("Alert.alert");
    expect(collection).not.toContain("createScan");
    expect(collection).not.toContain("confirmScan");

    expect(decide).toContain("convertWatchlistToPurchased");
    expect(decide).toContain("playPurchasedSuccessHaptic");
    expect(decide).toContain("inventoryItemId");
    expect(decide).not.toContain("createScan");
    expect(decide).not.toContain("confirmScan");
    expect(decide).not.toContain("PurchaseSheet");

    expect(convertClient).toContain("apiContract.convertWatchlistToPurchased");
    expect(client).toContain('path: "/v1/inventory/:inventoryItemId/purchased"');
    expect(convertClient).not.toContain("createScan");
    expect(convertClient).not.toContain("confirmScan");
    expect(client).toContain("convertWatchlistToPurchased");

    expect(api).toContain('app.post("/v1/inventory/:inventoryItemId/purchased"');
    expect(api).toContain("watchlistConversionTags");
    expect(api).toContain("WATCHLIST_CLOSED_WORKFLOW_STATE");
    expect(api).toContain("isClosedWatchlist");
    expect(api).toContain("watchlistSourceIdFromTags");

    expect(bubble).toContain("Watchlist Purchased");
    expect(purchase).toContain("Watchlist one-tap Purchased");
    expect(tile).toContain("`Max ${targetMaxBuyDisplay}`");
  });
});
