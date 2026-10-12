/**
 * Optional native sample-buffer pump for in-stream live video.
 * Never the phone camera product, never a WebView screenshot.
 *
 * Expo Go (SDK 57) does not ship `cardflow-live-video`. Look the module up
 * with `requireOptionalNativeModule` and treat a miss as "capture off" —
 * never `requireNativeModule`, which throws at import / first call.
 */
import { requireOptionalNativeModule } from "expo";
import { NativeModules, Platform } from "react-native";
import {
  normalizeLiveCardBox,
  LIVE_VIDEO_IDENTITY_RGB_BYTES,
  LIVE_VIDEO_IDENTITY_RGB_SIZE,
  rgbPerceptualHash,
  type LiveVideoFrame,
} from "@cardflow/shared";
import { isExpoGoRuntime } from "./runtime-host";

interface CardFlowLiveVideoNative {
  pullSampleBuffer?: () => Promise<unknown>;
  setScannerSession?: (active: boolean) => Promise<void>;
  setPlaybackUrl?: (url: string | null) => Promise<void>;
  setYoloDetect?: (active: boolean) => Promise<void>;
}

/** Custom native modules that are not compiled into Expo Go. */
export const EXPO_GO_OPTIONAL_NATIVE_MODULES = ["CardFlowLiveVideo"] as const;

function optionalNativeModule<T extends object>(name: string): T | null {
  if (Platform.OS === "web") return null;
  try {
    const expoModule = requireOptionalNativeModule<T>(name);
    if (expoModule) return expoModule;
  } catch {
    /* Expo Go and other hosts without this custom module */
  }
  try {
    const modules = NativeModules as Record<string, T | undefined>;
    return modules[name] ?? null;
  } catch {
    return null;
  }
}

function nativeModule(): CardFlowLiveVideoNative | null {
  return optionalNativeModule<CardFlowLiveVideoNative>("CardFlowLiveVideo");
}

export function isLiveVideoNativeAvailable(): boolean {
  if (Platform.OS === "web") return false;
  if (isExpoGoRuntime()) return false;
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

function cropQuad(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== 8) return null;
  if (!raw.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  return raw as number[];
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

export async function setLiveVideoYoloDetect(active: boolean): Promise<void> {
  const native = nativeModule();
  if (!native?.setYoloDetect) return;
  try {
    await native.setYoloDetect(active);
  } catch {
    /* native build without the YOLO hook */
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

export async function pullLiveVideoSampleBuffer(): Promise<LiveVideoFrame | null> {
  const native = nativeModule();
  if (!native?.pullSampleBuffer) return null;
  try {
    const raw = await native.pullSampleBuffer();
    if (!raw || typeof raw !== "object") return null;
    const frame = raw as Record<string, unknown>;
    if (frame.source !== "live_video") return null;
    return {
      source: "live_video",
      cardDetected: Boolean(frame.cardDetected),
      classifiedTcgdexId:
        typeof frame.classifiedTcgdexId === "string" ? frame.classifiedTcgdexId : null,
      identityHash: identityHashFromRgb(frame.identityRgb),
      identityCropJpeg:
        typeof frame.identityCropJpeg === "string" ? frame.identityCropJpeg : null,
      identityCropQuad: cropQuad(frame.identityCropQuad),
      cardBox: normalizeLiveCardBox(frame.cardBox),
      detectMs: typeof frame.detectMs === "number" ? frame.detectMs : null,
      videoFrameJpeg: typeof frame.videoFrameJpeg === "string" ? frame.videoFrameJpeg : null,
    };
  } catch {
    return null;
  }
}
