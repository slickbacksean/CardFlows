/**
 * Optional native sample-buffer pump for in-stream live video.
 * Never the phone camera product, never a WebView screenshot.
 */
import { requireOptionalNativeModule } from "expo";
import { NativeModules, Platform } from "react-native";
import {
  LIVE_VIDEO_IDENTITY_RGB_BYTES,
  LIVE_VIDEO_IDENTITY_RGB_SIZE,
  cardQuadFromYolo26n,
  isCardQuad,
  normalizeLiveVideoDetectorMode,
  resolveLiveVideoDetectorConfig,
  rgbPerceptualHash,
  type CardQuad,
  type LiveVideoDetectorAbSample,
  type LiveVideoDetectorBox,
  type LiveVideoDetectorObservation,
  type LiveVideoFrame,
} from "@cardflow/shared";

interface CardFlowLiveVideoNative {
  pullSampleBuffer?: () => Promise<unknown>;
  setScannerSession?: (active: boolean) => Promise<void>;
  setPlaybackUrl?: (url: string | null) => Promise<void>;
  setDetectorConfig?: (config: Record<string, unknown>) => Promise<void>;
}

function nativeModule(): CardFlowLiveVideoNative | null {
  const expoModule = requireOptionalNativeModule<CardFlowLiveVideoNative>("CardFlowLiveVideo");
  if (expoModule?.pullSampleBuffer) return expoModule;
  const modules = NativeModules as { CardFlowLiveVideo?: CardFlowLiveVideoNative };
  return modules.CardFlowLiveVideo ?? null;
}

export function isLiveVideoNativeAvailable(): boolean {
  if (Platform.OS === "web") return false;
  return Boolean(nativeModule()?.pullSampleBuffer);
}

function packedRgbBytes(raw: unknown): Uint8Array | null {
  if (typeof raw === "string") {
    try {
      const binary = globalThis.atob(raw);
      if (binary.length !== LIVE_VIDEO_IDENTITY_RGB_BYTES) return null;
      const data = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
      return data;
    } catch {
      return null;
    }
  }
  if (Array.isArray(raw) && raw.length === LIVE_VIDEO_IDENTITY_RGB_BYTES) {
    const data = new Uint8Array(LIVE_VIDEO_IDENTITY_RGB_BYTES);
    for (let i = 0; i < LIVE_VIDEO_IDENTITY_RGB_BYTES; i++) {
      const value = raw[i];
      if (typeof value !== "number" || value < 0 || value > 255) return null;
      data[i] = value;
    }
    return data;
  }
  return null;
}

function identityHashFromRgb(raw: unknown): string | null {
  const data = packedRgbBytes(raw);
  if (!data) return null;
  return rgbPerceptualHash({
    width: LIVE_VIDEO_IDENTITY_RGB_SIZE,
    height: LIVE_VIDEO_IDENTITY_RGB_SIZE,
    data,
  });
}

export async function setLiveVideoScannerSession(active: boolean): Promise<void> {
  const native = nativeModule();
  if (!native?.setScannerSession) return;
  try {
    await native.setScannerSession(active);
  } catch {
    /* native build without the session hook */
  }
}

export async function setLiveVideoPlaybackUrl(url: string | null): Promise<void> {
  const native = nativeModule();
  if (!native?.setPlaybackUrl) return;
  try {
    await native.setPlaybackUrl(url);
  } catch {
    /* native build without the playlist player */
  }
}

function detectorBox(raw: unknown): LiveVideoDetectorBox | null {
  if (!raw || typeof raw !== "object") return null;
  const box = raw as Record<string, unknown>;
  const x = typeof box.x === "number" ? box.x : null;
  const y = typeof box.y === "number" ? box.y : null;
  const width = typeof box.width === "number" ? box.width : null;
  const height = typeof box.height === "number" ? box.height : null;
  if (x == null || y == null || width == null || height == null) return null;
  return {
    x,
    y,
    width,
    height,
    confidence: typeof box.confidence === "number" ? box.confidence : undefined,
  };
}

function detectorObservation(
  backend: "rectangle" | "yolo26n",
  raw: unknown,
): LiveVideoDetectorObservation | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  return {
    backend,
    cardDetected: Boolean(row.cardDetected),
    box: detectorBox(row.box),
    latencyMs: typeof row.latencyMs === "number" ? row.latencyMs : 0,
  };
}

function detectorAb(raw: unknown): LiveVideoDetectorAbSample | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const yolo = detectorObservation("yolo26n", row.yolo);
  const rectangle = detectorObservation("rectangle", row.rectangle);
  if (!yolo || !rectangle) return null;
  return {
    yolo,
    rectangle,
    iou: typeof row.iou === "number" ? row.iou : null,
    agreement: Boolean(row.agreement),
    cropSource:
      row.cropSource === "yolo26n" ||
      row.cropSource === "rectangle" ||
      row.cropSource === "fallback_rectangle"
        ? row.cropSource
        : "rectangle",
  };
}

export function liveVideoDetectorConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
) {
  return resolveLiveVideoDetectorConfig({
    env,
    easBuildProfile: env.EAS_BUILD_PROFILE ?? env.EXPO_PUBLIC_EAS_BUILD_PROFILE ?? null,
    mode: env.EXPO_PUBLIC_CARD_FLOW_YOLO26N_MODE ?? env.CARD_FLOW_YOLO26N_MODE,
  });
}

export async function setLiveVideoDetectorConfig(
  config: ReturnType<typeof liveVideoDetectorConfigFromEnv> & { modelPath?: string | null },
): Promise<void> {
  const native = nativeModule();
  if (!native?.setDetectorConfig) return;
  try {
    await native.setDetectorConfig({
      yoloEnabled: config.yoloEnabled,
      mode: normalizeLiveVideoDetectorMode(config.mode),
      modelPath: config.modelPath ?? null,
      licenseTodo: config.licenseTodo,
    });
  } catch {
    /* native build without the detector hook */
  }
}

export async function pullLiveVideoSampleBuffer(): Promise<LiveVideoFrame | null> {
  const native = nativeModule();
  if (!native?.pullSampleBuffer) return null;
  try {
    const raw = await native.pullSampleBuffer();
    if (!raw || typeof raw !== "object") return null;
    const frame = raw as Record<string, unknown>;
    if (frame.source !== "live_video") return null;
    const ab = detectorAb(frame.detectorAb);
    const imageWidth = typeof frame.imageWidth === "number" ? frame.imageWidth : null;
    const imageHeight = typeof frame.imageHeight === "number" ? frame.imageHeight : null;
    const nativeQuad = isCardQuad(frame.cardQuad) ? frame.cardQuad : null;
    const constructed =
      nativeQuad ??
      (ab?.yolo.cardDetected && imageWidth && imageHeight
        ? cardQuadFromYolo26n({
            box: ab.yolo.box,
            imageWidth,
            imageHeight,
            origin: "top-left",
          })
        : null);
    const cardQuad: CardQuad | null =
      constructed?.source === "yolo26n-ab" ? constructed : null;
    return {
      source: "live_video",
      cardDetected: Boolean(frame.cardDetected),
      classifiedTcgdexId:
        typeof frame.classifiedTcgdexId === "string" ? frame.classifiedTcgdexId : null,
      identityHash: identityHashFromRgb(frame.identityRgb),
      identityCropJpeg:
        typeof frame.identityCropJpeg === "string" ? frame.identityCropJpeg : null,
      detector:
        typeof frame.detector === "string"
          ? (frame.detector as LiveVideoFrame["detector"])
          : null,
      detectLatencyMs: typeof frame.detectLatencyMs === "number" ? frame.detectLatencyMs : null,
      detectorAb: ab,
      cardQuad,
      imageWidth,
      imageHeight,
    };
  } catch {
    return null;
  }
}
