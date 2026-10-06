/**
 * Optional native sample-buffer pump for in-stream live video.
 * Never the phone camera product, never a WebView screenshot.
 */
import { requireOptionalNativeModule } from "expo";
import { NativeModules, Platform } from "react-native";
import {
  LIVE_VIDEO_IDENTITY_RGB_BYTES,
  LIVE_VIDEO_IDENTITY_RGB_SIZE,
  rgbPerceptualHash,
  type LiveVideoFrame,
} from "@cardflow/shared";

interface CardFlowLiveVideoNative {
  pullSampleBuffer?: () => Promise<unknown>;
  setScannerSession?: (active: boolean) => Promise<void>;
  setPlaybackUrl?: (url: string | null) => Promise<void>;
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
    };
  } catch {
    return null;
  }
}
