import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { confirmIdentity } from "./confirm";
import { liveOverlayGuessFromSources } from "./live-overlay-guess";
import {
  identifyLiveVideo,
  LIVE_IDENTITY_STABLE_HITS,
  mockLiveVideoFrame,
  stabilizeLiveIdentity,
} from "./live-video-identity";
import {
  livestreamOverlayKind,
  livestreamOverlayUsesHud,
} from "./livestream-overlay";
import { mapRecognitionToCatalog } from "./mapper";
import { identifyCardMock } from "./mock-recognition";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCREENSHOT_APIS =
  /view-shot|captureScreen|capturePage|takeSnapshot|toDataURL|captureRef|ViewShot/i;
const LEFTOVER_CARDFLOW_ID = "7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function identifiedHit(platform: "ios" | "android" = "ios") {
  return identifyLiveVideo({
    scannerOn: true,
    platform,
    frame: mockLiveVideoFrame("base1-58"),
    classifier: "mock",
  });
}

describe("Task 9 livestream device QA", () => {
  it("scanner off never emits overlay identity, including after Confirm", async () => {
    expect(
      livestreamOverlayKind({
        scannerOn: false,
        liveGuessTcgdexId: "base1-58",
      }),
    ).toBe("scanner_off");
    expect(livestreamOverlayUsesHud("scanner_off", true)).toBe(true);

    expect(
      identifyLiveVideo({
        scannerOn: false,
        platform: "ios",
        frame: mockLiveVideoFrame("base1-58"),
        classifier: "mock",
      }),
    ).toMatchObject({ tcgdexId: null, reason: "scanner_off" });
    expect(
      identifyLiveVideo({
        scannerOn: false,
        platform: "android",
        frame: mockLiveVideoFrame("base1-58"),
        classifier: "mock",
      }).reason,
    ).toBe("scanner_off");

    const overlay = readRepoFile("apps/mobile/components/ui/screener-overlay.tsx");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    expect(overlay).toContain("livestreamOverlayKind");
    expect(overlay).toContain("livestreamOverlayUsesHud");
    expect(overlay).toContain("Scanner off");
    expect(overlay).not.toMatch(SCREENSHOT_APIS);
    expect(scanTab).toContain("useState(false)");
    expect(scanTab).toContain("stopLiveVideoIdentify()");
  });

  it("scanner on with no card stays looking / unidentified and writes no inventory", () => {
    expect(
      livestreamOverlayKind({
        scannerOn: true,
      }),
    ).toBe("looking");
    expect(livestreamOverlayUsesHud("looking", true)).toBe(true);

    for (const platform of ["ios", "android"] as const) {
      expect(
        identifyLiveVideo({
          scannerOn: true,
          platform,
          frame: null,
          classifier: "mock",
        }),
      ).toMatchObject({ tcgdexId: null, reason: "no_card" });
      expect(
        identifyLiveVideo({
          scannerOn: true,
          platform,
          frame: { source: "live_video", cardDetected: false, classifiedTcgdexId: "base1-58" },
          classifier: "mock",
        }).reason,
      ).toBe("no_card");
      expect(
        identifyLiveVideo({
          scannerOn: true,
          platform,
          frame: { source: "live_video", cardDetected: true, classifiedTcgdexId: null },
          classifier: "mock",
        }).reason,
      ).toBe("unidentified");
    }

    const guess = liveOverlayGuessFromSources({ tcgdexId: "base1-58" });
    expect(guess?.writesInventory).toBe(false);

    const overlay = readRepoFile("apps/mobile/components/ui/screener-overlay.tsx");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const client = readRepoFile("apps/mobile/lib/api.ts");
    expect(overlay).toContain("Looking for a card…");
    expect(overlay).not.toContain("savePurchased");
    expect(overlay).toContain("I bought this");
    expect(scanTab).toContain("saveLivestreamPurchase");
    expect(scanTab).toContain("PurchaseSheet");
    expect(client).toContain("/v1/livestream/identify");
    expect(client).not.toMatch(/saveInventoryItem|addPurchased/);
  });

  it("same card for two stable hits fills the overlay guess on iOS and Android", () => {
    expect(LIVE_IDENTITY_STABLE_HITS).toBe(2);
    expect(stabilizeLiveIdentity([identifiedHit()]).reason).toBe("unidentified");
    expect(stabilizeLiveIdentity([identifiedHit(), identifiedHit()]).tcgdexId).toBe("base1-58");
    expect(
      stabilizeLiveIdentity([identifiedHit("android"), identifiedHit("android")]).tcgdexId,
    ).toBe("base1-58");

    expect(
      livestreamOverlayKind({
        scannerOn: true,
        liveGuessTcgdexId: "base1-58",
      }),
    ).toBe("live_guess");

    const liveIdentify = readRepoFile("apps/mobile/lib/live-identify.ts");
    const overlay = readRepoFile("apps/mobile/components/ui/screener-overlay.tsx");
    expect(liveIdentify).toContain("stabilizeLiveIdentity");
    expect(liveIdentify).toContain("publish(mockFrame);\n  publish(mockFrame);");
    expect(overlay).toContain("getLiveOverlayGuess");
    expect(overlay).toContain("isStableLiveIdentity");
    expect(overlay).toContain("Live guess · not confirmed");
  });

  it("Whatnot | eBay switch remounts the live page without a screenshot path", () => {
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const livestream = readRepoFile("apps/mobile/lib/livestream.ts");
    const browser = readRepoFile("apps/mobile/components/ui/livestream-browser.tsx");
    const inApp = readRepoFile("apps/mobile/lib/in-app-browser.ts");
    const selectPlatform = scanTab.slice(
      scanTab.indexOf("function selectPlatform"),
      scanTab.indexOf("function toggleScanner"),
    );

    expect(livestream).toContain('pageUrl: "https://www.whatnot.com"');
    expect(livestream).toContain('pageUrl: "https://www.ebay.com/ebaylive"');
    expect(scanTab).toContain("LIVESTREAM_PLATFORM_ORDER");
    expect(selectPlatform).toContain("setBrowserEpoch");
    expect(selectPlatform).toContain("stopLiveVideoIdentify()");
    expect(selectPlatform).toContain("startLiveVideoIdentify()");
    expect(selectPlatform).not.toMatch(SCREENSHOT_APIS);
    expect(selectPlatform).not.toContain("/capture");
    expect(browser).toContain("reloadKey");
    expect(browser).toContain("url");
    expect(browser).not.toMatch(SCREENSHOT_APIS);
    expect(inApp).toContain("allowScreenshotsFromWebPage: false");
    expect(inApp).not.toContain("executeScript");
    expect(scanTab).not.toContain("injectedJavaScript");
    expect(scanTab).not.toMatch(/bid|placeBid|scrape/i);
  });

  it("Confirm does not fill the overlay and the live guess does not mint", async () => {
    const mapping = await mapRecognitionToCatalog(identifyCardMock("high-confidence"));
    const confirmed = confirmIdentity({
      mapping,
      selectedTcgdexId: "base1-58",
      createId: () => LEFTOVER_CARDFLOW_ID,
    });
    expect(confirmed.canonicalCard.mintedOn).toBe("confirm");
    expect(confirmed.canonicalCard.cardflowCardId).toBe(LEFTOVER_CARDFLOW_ID);
    expect(confirmed.mintedCardflowCardId).toBe(true);

    expect(
      livestreamOverlayKind({
        scannerOn: false,
      }),
    ).toBe("scanner_off");
    expect(
      livestreamOverlayKind({
        scannerOn: true,
        liveGuessTcgdexId: "base1-58",
      }),
    ).toBe("live_guess");

    const guess = liveOverlayGuessFromSources({ tcgdexId: "base1-58" });
    expect(guess?.tcgdexId).toBe("base1-58");
    expect(guess?.notConfirmed).toBe(true);
    expect(guess?.writesInventory).toBe(false);
    expect(JSON.stringify(guess)).not.toMatch(/cardflowCardId|cardflow_card_id/);

    const confirmScreen = readRepoFile("apps/mobile/app/scan/[scanId].tsx");
    const decideScreen = readRepoFile("apps/mobile/app/decide/[cardflowCardId].tsx");
    const overlay = readRepoFile("apps/mobile/components/ui/screener-overlay.tsx");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    expect(confirmScreen).not.toContain("setLivestreamOverlayCard");
    expect(decideScreen).not.toContain("patchLivestreamOverlayCard");
    expect(scanTab).not.toContain("getLivestreamOverlayCardForUser");
    expect(overlay).not.toContain("you typed");
    expect(overlay).toContain("Scanner off");
    expect(overlay).not.toContain("savePurchased");
  });

  it("forbids view-shot and Capture on the livestream tab for iOS and Android", () => {
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const overlay = readRepoFile("apps/mobile/components/ui/screener-overlay.tsx");
    const liveIdentify = readRepoFile("apps/mobile/lib/live-identify.ts");
    const nativeJs = readRepoFile("apps/mobile/lib/live-video-native.ts");
    const iosPump = readRepoFile(
      "apps/mobile/modules/cardflow-live-video/ios/CardFlowLiveVideoModule.swift",
    );
    const androidPump = readRepoFile(
      "apps/mobile/modules/cardflow-live-video/android/src/main/java/expo/modules/cardflowlivevideo/CardFlowLiveVideoModule.kt",
    );

    for (const source of [scanTab, overlay, liveIdentify, nativeJs, iosPump, androidPump]) {
      expect(source).not.toMatch(SCREENSHOT_APIS);
    }
    expect(scanTab).not.toContain("/capture");
    expect(scanTab).not.toContain("/v1/scans");
    expect(scanTab).toContain('Platform.OS === "web"');
    expect(scanTab).toContain("LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE");
    expect(overlay).toContain("LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE");
    expect(iosPump).toContain("live_video");
    expect(androidPump).toContain("live_video");
    expect(iosPump).not.toContain("IOSurface");
    expect(iosPump).not.toMatch(/AVCaptureDevice|AVCaptureSession/);
    expect(iosPump).toContain("setPlaybackUrl");
    expect(iosPump).toContain("setScannerSession");
    expect(androidPump).toContain("setPlaybackUrl");
    expect(androidPump).toContain("isBlankFrame");
    expect(androidPump).toContain("MediaPlayer");
    expect(androidPump).not.toMatch(/CameraX|takeScreenshot|MediaProjection/);
    expect(liveIdentify).toContain("Do not snapshot the live page");
  });
});
