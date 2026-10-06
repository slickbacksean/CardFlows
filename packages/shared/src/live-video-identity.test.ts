import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifiedTcgdexIdFromLiveVideoMetadata,
  identifyLiveVideo,
  isLiveVideoIdentityAvailable,
  LIVE_VIDEO_IDENTITY_HASH_BITS,
  LIVE_VIDEO_IDENTITY_RGB_BYTES,
  LIVE_VIDEO_IDENTITY_RGB_SIZE,
  LIVESTREAM_IDENTIFY_PIPELINE,
  LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE,
  mockLiveVideoFrame,
  normalizeLiveVideoIdentityHash,
  normalizeLiveVideoTcgdexId,
  stabilizeLiveIdentity,
} from "./live-video-identity";
import { RGB_PHASH_BITS, RGB_PHASH_SIZE } from "./obb-phash";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const SCREENSHOT_APIS =
  /view-shot|captureScreen|capturePage|takeSnapshot|toDataURL|captureRef|ViewShot/i;

describe("combined YOLO + card-identity on live video", () => {
  it("is native-only and never invents a catalog id", () => {
    expect(isLiveVideoIdentityAvailable("ios")).toBe(true);
    expect(isLiveVideoIdentityAvailable("android")).toBe(true);
    expect(isLiveVideoIdentityAvailable("web")).toBe(false);
    expect(normalizeLiveVideoTcgdexId("base1-58")).toBe("base1-58");
    expect(normalizeLiveVideoTcgdexId("not a card")).toBeNull();
    expect(normalizeLiveVideoTcgdexId("")).toBeNull();
    expect(LIVE_VIDEO_IDENTITY_HASH_BITS).toBe(RGB_PHASH_BITS);
    expect(LIVE_VIDEO_IDENTITY_RGB_SIZE).toBe(RGB_PHASH_SIZE);
    expect(LIVE_VIDEO_IDENTITY_RGB_BYTES).toBe(RGB_PHASH_SIZE * RGB_PHASH_SIZE * 3);
    expect(normalizeLiveVideoIdentityHash("1".repeat(LIVE_VIDEO_IDENTITY_HASH_BITS))).toHaveLength(
      LIVE_VIDEO_IDENTITY_HASH_BITS,
    );
    expect(normalizeLiveVideoIdentityHash("not-a-hash")).toBeNull();
    expect(normalizeLiveVideoIdentityHash("1".repeat(8))).toBeNull();
    expect(
      classifiedTcgdexIdFromLiveVideoMetadata({
        classifiedTcgdexId: "base1-58",
        identityHash: "1".repeat(LIVE_VIDEO_IDENTITY_HASH_BITS),
        matchedTcgdexId: "base1-4",
      }),
    ).toBe("base1-58");
    expect(
      classifiedTcgdexIdFromLiveVideoMetadata({
        classifiedTcgdexId: null,
        identityHash: "1".repeat(LIVE_VIDEO_IDENTITY_HASH_BITS),
        matchedTcgdexId: "swsh3-136",
      }),
    ).toBe("swsh3-136");
    expect(
      classifiedTcgdexIdFromLiveVideoMetadata({
        classifiedTcgdexId: null,
        identityHash: null,
        matchedTcgdexId: "base1-58",
      }),
    ).toBeNull();

    expect(
      identifyLiveVideo({
        scannerOn: false,
        platform: "ios",
        frame: mockLiveVideoFrame("base1-58"),
        classifier: "mock",
      }),
    ).toMatchObject({ tcgdexId: null, reason: "scanner_off", pipeline: LIVESTREAM_IDENTIFY_PIPELINE });

    expect(
      identifyLiveVideo({
        scannerOn: true,
        platform: "web",
        frame: mockLiveVideoFrame("base1-58"),
        classifier: "mock",
      }),
    ).toMatchObject({ tcgdexId: null, reason: "unavailable" });

    expect(
      identifyLiveVideo({
        scannerOn: true,
        platform: "ios",
        frame: null,
        classifier: "mock",
      }),
    ).toMatchObject({ tcgdexId: null, reason: "no_card" });

    expect(
      identifyLiveVideo({
        scannerOn: true,
        platform: "ios",
        frame: {
          source: "live_video",
          cardDetected: false,
          classifiedTcgdexId: "base1-58",
        },
        classifier: "mock",
      }),
    ).toMatchObject({ tcgdexId: null, reason: "no_card" });

    expect(
      identifyLiveVideo({
        scannerOn: true,
        platform: "android",
        frame: { source: "live_video", cardDetected: true, classifiedTcgdexId: null },
        classifier: "mock",
      }),
    ).toMatchObject({ tcgdexId: null, reason: "unidentified" });

    expect(
      identifyLiveVideo({
        scannerOn: true,
        platform: "ios",
        frame: mockLiveVideoFrame("base1-58"),
        classifier: "none",
      }),
    ).toMatchObject({ tcgdexId: null, reason: "unidentified" });

    expect(
      stabilizeLiveIdentity([
        identifyLiveVideo({
          scannerOn: true,
          platform: "ios",
          frame: mockLiveVideoFrame("base1-58"),
          classifier: "yolo_identity",
        }),
      ]).reason,
    ).toBe("unidentified");
    expect(
      stabilizeLiveIdentity([
        identifyLiveVideo({
          scannerOn: true,
          platform: "ios",
          frame: mockLiveVideoFrame("base1-58"),
          classifier: "yolo_identity",
        }),
        identifyLiveVideo({
          scannerOn: true,
          platform: "ios",
          frame: mockLiveVideoFrame("base1-58"),
          classifier: "yolo_identity",
        }),
      ]).tcgdexId,
    ).toBe("base1-58");
  });

  it("emits a tcgdex id only when detect and classify both succeed on live video", () => {
    expect(
      identifyLiveVideo({
        scannerOn: true,
        platform: "ios",
        frame: mockLiveVideoFrame("base1-58"),
        classifier: "mock",
      }),
    ).toEqual({
      tcgdexId: "base1-58",
      confidence: "High",
      reason: "identified",
      pipeline: LIVESTREAM_IDENTIFY_PIPELINE,
    });

    expect(
      identifyLiveVideo({
        scannerOn: true,
        platform: "android",
        frame: mockLiveVideoFrame("swsh3-136"),
        classifier: "yolo_identity",
      }).tcgdexId,
    ).toBe("swsh3-136");
  });

  it("does not screenshot the livestream, POST a still, or ship Ultralytics weights", () => {
    const liveIdentify = readRepoFile("apps/mobile/lib/live-identify.ts");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const overlay = readRepoFile("apps/mobile/components/ui/screener-overlay.tsx");
    const pipeline = readRepoFile("packages/shared/src/live-video-identity.ts");
    const gitignore = readRepoFile(".gitignore");
    const mobilePackage = readRepoFile("apps/mobile/package.json");

    expect(liveIdentify).toContain("identifyLiveVideo");
    expect(liveIdentify).toContain("injectMockLiveVideoCard");
    expect(liveIdentify).toContain("pullLiveVideoSampleBuffer");
    expect(liveIdentify).toContain("stabilizeLiveIdentity");
    expect(liveIdentify).toContain("identifyLivestreamFrame");
    expect(liveIdentify).toContain("/v1/livestream/identify");
    expect(liveIdentify).toContain("identityHash");
    expect(liveIdentify).toContain('__DEV__ ? "mock" : "none"');
    expect(liveIdentify).not.toMatch(SCREENSHOT_APIS);

    const nativeJs = readRepoFile("apps/mobile/lib/live-video-native.ts");
    const iosPump = readRepoFile(
      "apps/mobile/modules/cardflow-live-video/ios/CardFlowLiveVideoModule.swift",
    );
    const androidPump = readRepoFile(
      "apps/mobile/modules/cardflow-live-video/android/src/main/java/expo/modules/cardflowlivevideo/CardFlowLiveVideoModule.kt",
    );
    const moduleConfig = readRepoFile(
      "apps/mobile/modules/cardflow-live-video/expo-module.config.json",
    );
    expect(nativeJs).toContain("CardFlowLiveVideo");
    expect(nativeJs).toContain("pullSampleBuffer");
    expect(nativeJs).toContain("requireOptionalNativeModule");
    expect(nativeJs).toContain("identityRgb");
    expect(nativeJs).toContain("rgbPerceptualHash");
    expect(nativeJs).not.toMatch(SCREENSHOT_APIS);
    expect(moduleConfig).toContain("CardFlowLiveVideoModule");
    expect(moduleConfig).toContain("android");
    expect(moduleConfig).toContain("expo.modules.cardflowlivevideo.CardFlowLiveVideoModule");
    expect(iosPump).toContain('Name("CardFlowLiveVideo")');
    expect(iosPump).toContain("pullSampleBuffer");
    expect(iosPump).toContain("WKWebView");
    expect(iosPump).toContain("AVPlayerItemVideoOutput");
    expect(iosPump).toContain("copyPixelBuffer");
    expect(iosPump).toContain("cardDetected");
    expect(iosPump).toContain("live_video");
    expect(iosPump).toContain("identityRgb");
    expect(iosPump).toContain("LiveVideoIdentityCrop");
    expect(iosPump).not.toContain("classifiedTcgdexId");
    expect(iosPump).not.toMatch(SCREENSHOT_APIS);
    expect(iosPump).not.toContain("IOSurface");
    expect(iosPump).not.toMatch(/AVCaptureDevice|AVCaptureSession|CameraX/);
    expect(androidPump).toContain('Name("CardFlowLiveVideo")');
    expect(androidPump).toContain("pullSampleBuffer");
    expect(androidPump).toContain("WebView");
    expect(androidPump).toContain("SurfaceView");
    expect(androidPump).toContain("TextureView");
    expect(androidPump).toContain("PixelCopy");
    expect(androidPump).toContain("copyLiveVideoPixelBuffer");
    expect(androidPump).toContain("cardDetected");
    expect(androidPump).toContain("live_video");
    expect(androidPump).toContain("identityRgb");
    expect(androidPump).toContain("LiveVideoIdentityCrop");
    expect(androidPump).not.toContain("classifiedTcgdexId");
    expect(androidPump).not.toMatch(SCREENSHOT_APIS);
    expect(androidPump).not.toMatch(/AVCaptureDevice|AVCaptureSession|CameraX/);
    expect(androidPump).not.toMatch(/takeScreenshot|capturePicture|MediaProjection|VirtualDisplay/);
    expect(liveIdentify).not.toContain("/v1/scans");
    expect(liveIdentify).not.toContain("createScan");
    expect(scanTab).not.toMatch(SCREENSHOT_APIS);
    expect(scanTab).not.toContain("/v1/scans");
    expect(scanTab).not.toContain("/capture");
    expect(scanTab).toContain("injectMockLiveVideoCard");
    expect(scanTab).toContain("LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE");
    expect(LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE).toBe(
      "Livestream works in the iOS and Android app.",
    );
    expect(scanTab).toContain('Platform.OS === "web"');
    expect(scanTab).toContain("goBack");
    expect(scanTab).toContain("goForward");
    expect(scanTab).toContain("PAGE ON");
    expect(scanTab).toContain("SCANNER ON");
    expect(scanTab).not.toMatch(/Scan a still photo/i);
    expect(overlay).toContain("liveGuess");
    expect(overlay).toContain("getLiveOverlayGuess");
    expect(overlay).not.toMatch(SCREENSHOT_APIS);
    expect(pipeline).toContain("live_video");
    expect(pipeline).toContain("Ultralytics AGPL");
    expect(pipeline).not.toMatch(/cardflowCardId|cardflow_card_id/);
    expect(pipeline).not.toMatch(/pokemon-card-scanning-webapp|ShreyShingala/i);
    expect(mobilePackage).not.toMatch(/react-native-view-shot|ultralytics/i);
    expect(gitignore).toMatch(/\.pt/);
    expect(gitignore).toMatch(/\.onnx/);
    expect(gitignore).toContain("apps/mobile/models/");
    expect(gitignore).toContain("apps/api/models/");
  });
});
