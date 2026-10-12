import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isCardQuad } from "./card-quad";
import {
  boxIou,
  cardQuadFromYolo26n,
  chooseLiveVideoCropSource,
  compareLiveVideoDetectors,
  resolveLiveVideoDetectorConfig,
  summarizeLiveVideoDetectorAb,
  YOLO26N_CARD_QUAD_SOURCE,
  type LiveVideoDetectorObservation,
} from "./live-video-detector";
import {
  YOLO26N_LICENSE_SHIP_TODO,
  YOLO26N_SHIP_BLOCKED_PROFILES,
  isYolo26nShipBlockedProfile,
  ultralyticsAgplAccepted,
  yolo26nOnDeviceAllowed,
} from "./ultralytics-license";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function observation(
  backend: "rectangle" | "yolo26n",
  detected: boolean,
  box?: { x: number; y: number; width: number; height: number },
  latencyMs = 10,
): LiveVideoDetectorObservation {
  return {
    backend,
    cardDetected: detected,
    box: detected ? (box ?? { x: 0.2, y: 0.2, width: 0.4, height: 0.5 }) : null,
    latencyMs,
  };
}

describe("on-device YOLO26n license gate", () => {
  it("stays off without AGPL, without the opt-in, and on store profiles", () => {
    expect(ultralyticsAgplAccepted({})).toBe(false);
    expect(
      yolo26nOnDeviceAllowed({
        env: { CARD_FLOW_YOLO26N_ONDEVICE: "true" },
      }),
    ).toBe(false);
    expect(
      yolo26nOnDeviceAllowed({
        env: { CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED: "true" },
      }),
    ).toBe(false);
    expect(
      yolo26nOnDeviceAllowed({
        env: {
          CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED: "true",
          CARD_FLOW_YOLO26N_ONDEVICE: "true",
        },
      }),
    ).toBe(true);
    expect(
      yolo26nOnDeviceAllowed({
        env: {
          EXPO_PUBLIC_CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED: "true",
          EXPO_PUBLIC_CARD_FLOW_YOLO26N_ONDEVICE: "true",
        },
      }),
    ).toBe(true);
    for (const profile of YOLO26N_SHIP_BLOCKED_PROFILES) {
      expect(isYolo26nShipBlockedProfile(profile)).toBe(true);
      expect(
        yolo26nOnDeviceAllowed({
          easBuildProfile: profile,
          env: {
            CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED: "true",
            CARD_FLOW_YOLO26N_ONDEVICE: "true",
          },
        }),
      ).toBe(false);
    }
    expect(YOLO26N_LICENSE_SHIP_TODO).toMatch(/Ultralytics Enterprise|AGPL-3\.0/);
    expect(YOLO26N_LICENSE_SHIP_TODO).toMatch(/TODO\(ship\)/);
  });

  it("forces the rectangle fallback when the gate is closed", () => {
    expect(resolveLiveVideoDetectorConfig({}).mode).toBe("rectangle");
    expect(resolveLiveVideoDetectorConfig({}).yoloEnabled).toBe(false);
    expect(
      resolveLiveVideoDetectorConfig({
        mode: "ab",
        env: {
          CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED: "true",
          CARD_FLOW_YOLO26N_ONDEVICE: "true",
        },
      }),
    ).toMatchObject({ mode: "ab", yoloEnabled: true });
    expect(
      resolveLiveVideoDetectorConfig({
        env: {
          CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED: "true",
          CARD_FLOW_YOLO26N_ONDEVICE: "true",
          EAS_BUILD_PROFILE: "production",
        },
      }).mode,
    ).toBe("rectangle");
  });
});

describe("YOLO26n CardQuad", () => {
  it("emits source yolo26n-ab with TL TR BR BL corners in top-left pixels", () => {
    const quad = cardQuadFromYolo26n({
      box: { x: 0.2, y: 0.1, width: 0.4, height: 0.5, confidence: 0.8 },
      imageWidth: 1000,
      imageHeight: 1000,
    });
    expect(quad).not.toBeNull();
    expect(isCardQuad(quad)).toBe(true);
    expect(quad?.source).toBe(YOLO26N_CARD_QUAD_SOURCE);
    expect(quad?.source).toBe("yolo26n-ab");
    expect(quad?.corners).toEqual([
      [200, 100],
      [600, 100],
      [600, 600],
      [200, 600],
    ]);
    expect(quad?.accepted).toBe(true);
    expect(quad?.outOfPlaneDeg).toBeNull();
    expect(
      cardQuadFromYolo26n({
        box: { x: 0.2, y: 0.1, width: 0.4, height: 0.5, confidence: 0.8 },
        imageWidth: 1000,
        imageHeight: 1000,
        origin: "bottom-left",
      })?.corners[0],
    ).toEqual([200, 400]);
    expect(cardQuadFromYolo26n({ box: null, imageWidth: 100, imageHeight: 100 })).toBeNull();
  });
});

describe("livestream detector A/B harness", () => {
  it("compares IoU, agreement, crop fallback, and latency rollup", () => {
    expect(
      boxIou(
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
      ),
    ).toBeCloseTo(0.25);
    expect(boxIou(null, { x: 0, y: 0, width: 1, height: 1 })).toBeNull();

    const yoloHit = observation("yolo26n", true, { x: 0.2, y: 0.2, width: 0.4, height: 0.5 }, 18);
    const rectHit = observation("rectangle", true, { x: 0.21, y: 0.19, width: 0.39, height: 0.52 }, 6);
    const rectOnly = observation("rectangle", true, { x: 0.1, y: 0.1, width: 0.3, height: 0.4 }, 7);
    const yoloMiss = observation("yolo26n", false, undefined, 16);

    const agree = compareLiveVideoDetectors(yoloHit, rectHit);
    expect(agree.agreement).toBe(true);
    expect(agree.cropSource).toBe("yolo26n");
    expect(agree.iou).toBeGreaterThan(0.8);

    expect(chooseLiveVideoCropSource(yoloMiss, rectOnly)).toBe("fallback_rectangle");
    expect(compareLiveVideoDetectors(yoloMiss, rectOnly).agreement).toBe(false);

    const summary = summarizeLiveVideoDetectorAb([
      agree,
      compareLiveVideoDetectors(yoloMiss, rectOnly),
    ]);
    expect(summary).toMatchObject({
      frames: 2,
      yoloDetections: 1,
      rectangleDetections: 2,
      bothDetected: 1,
      agreed: 1,
    });
    expect(summary.meanYoloLatencyMs).toBeCloseTo(17);
    expect(summary.meanRectangleLatencyMs).toBeCloseTo(6.5);
  });
});

describe("pre-ship YOLO26n stays out of production / App Store builds", () => {
  it("eas production/preview force the opt-in off and native code keeps rectangle fallback", () => {
    const eas = JSON.parse(readRepoFile("apps/mobile/eas.json")) as {
      build: Record<
        string,
        { env?: Record<string, string>; distribution?: string; developmentClient?: boolean }
      >;
    };
    const production = eas.build.production;
    const preview = eas.build.preview;
    const development = eas.build.development;
    expect(production?.distribution).toBe("store");
    expect(production?.env?.CARD_FLOW_YOLO26N_ONDEVICE).toBe("false");
    expect(production?.env?.EXPO_PUBLIC_CARD_FLOW_YOLO26N_ONDEVICE).toBe("false");
    expect(production?.env?.EXPO_PUBLIC_CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED).toBe("false");
    expect(preview?.env?.CARD_FLOW_YOLO26N_ONDEVICE).toBe("false");
    expect(development?.developmentClient).toBe(true);
    expect(development?.env?.CARD_FLOW_YOLO26N_ONDEVICE ?? "false").not.toBe("true");

    const appJson = readRepoFile("apps/mobile/app.json");
    expect(appJson).toContain('"yolo26nOnDevice": false');
    expect(appJson).toContain('"ultralyticsAgplAccepted": false');

    const ios = [
      readRepoFile("apps/mobile/modules/cardflow-live-video/ios/CardFlowLiveVideoModule.swift"),
      readRepoFile("apps/mobile/modules/cardflow-live-video/ios/Yolo26nCardDetect.swift"),
    ].join("\n");
    const android = [
      readRepoFile(
        "apps/mobile/modules/cardflow-live-video/android/src/main/java/expo/modules/cardflowlivevideo/CardFlowLiveVideoModule.kt",
      ),
      readRepoFile(
        "apps/mobile/modules/cardflow-live-video/android/src/main/java/expo/modules/cardflowlivevideo/Yolo26nCardDetect.kt",
      ),
    ].join("\n");
    const gradle = readRepoFile("apps/mobile/modules/cardflow-live-video/android/build.gradle");
    const envExample = readRepoFile("apps/api/.env.example");
    const gitignore = readRepoFile(".gitignore");
    const exportScript = readRepoFile(
      "apps/mobile/modules/cardflow-live-video/scripts/export-yolo26n-ondevice.py",
    );
    const trainScript = readRepoFile(
      "apps/mobile/modules/cardflow-live-video/scripts/finetune-yolo26n.py",
    );
    const evalPy = readRepoFile("services/card-finder/eval.py");
    const yoloRunner = readRepoFile("services/card-finder/yolo26n.py");
    const interfaceMd = readRepoFile("services/card-finder/INTERFACE.md");
    const cardQuadTs = readRepoFile("packages/shared/src/card-quad.ts");

    for (const source of [ios, android]) {
      expect(source).toContain("TODO(ship)");
      expect(source).toContain("Ultralytics");
      expect(source).toContain("AGPL");
      expect(source).toContain("Yolo26nCardDetect");
      expect(source).toContain("CardInStreamDetect");
      expect(source).toContain("fallback");
    }
    expect(ios).toContain("VNDetectRectanglesRequest");
    expect(ios).toContain("VNCoreMLRequest");
    expect(android).toContain("CardInStreamDetect");
    expect(gradle).toContain("YOLO26N_ONDEVICE");
    expect(gradle).not.toMatch(/tensorflow-lite|org\.tensorflow/);
    expect(envExample).toContain("CARD_FLOW_YOLO26N_ONDEVICE=");
    expect(envExample).toMatch(/CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=/);
    expect(gitignore).toContain(".yolo26n-export/");
    expect(gitignore).toMatch(/\.tflite/);
    expect(gitignore).toMatch(/\.mlpackage/);
    expect(exportScript).toContain("yolo26n.pt");
    expect(exportScript).toContain("coreml");
    expect(exportScript).toContain("litert");
    expect(exportScript).toContain("CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED");
    expect(trainScript).toContain("refuses synthetic");
    expect(trainScript).not.toContain("synthesize_split");
    expect(cardQuadTs).toContain('"yolo26n-ab"');
    expect(interfaceMd).toContain('source: "yolo26n-ab"');
    expect(evalPy).toContain("yolo26n");
    expect(evalPy).toContain("run_yolo26n");
    expect(yoloRunner).toContain('YOLO26N_SOURCE = "yolo26n-ab"');
    expect(yoloRunner).toContain("CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED");
    expect(yoloRunner).toContain("CARD_FLOW_YOLO26N_ONDEVICE");
    for (const source of [ios, android]) {
      expect(source).toContain("yolo26n-ab");
      expect(source).toContain("cardQuad");
    }
  });
});
