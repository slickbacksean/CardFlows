/**
 * Livestream scanner session. Combined YOLO + card-identity on live-video
 * sample buffers — never a page still, never Capture jpeg.
 * Do not snapshot the live page or POST a still.
 * Ultralytics weights stay gitignored until CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED.
 * Identity is live_video metadata (`identityHash`) → POST /v1/livestream/identify.
 */
import { Platform } from "react-native";
import {
  identifyLiveVideo,
  LIVE_IDENTITY_STABLE_HITS,
  mockLiveVideoFrame,
  normalizeLiveHlsUrl,
  stabilizeLiveIdentity,
  type LiveVideoFrame,
  type LiveVideoIdentityPlatform,
  type LiveVideoIdentityResult,
} from "@cardflow/shared";
import { identifyLivestreamFrame } from "./api";
import { publishLivestreamHud } from "./huds";
import {
  isLiveVideoNativeAvailable,
  pullLiveVideoSampleBuffer,
  setLiveVideoPlaybackUrl,
  setLiveVideoScannerSession,
} from "./live-video-native";

// OpenCLIP match on this Mac is ~630 ms cosine-only and ~720 ms with ORB
// (MPS, warm). 250 ms ticks only pile up behind pollInFlight. Match the poll
// to the measured match time so frames drop instead of queueing.
const FRAME_POLL_MS = 800;

let running = false;
let pendingHlsUrl: string | null = null;
let mockFrame: LiveVideoFrame | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;
let recentHits: LiveVideoIdentityResult[] = [];
let latest: LiveVideoIdentityResult = identifyLiveVideo({
  scannerOn: false,
  platform: liveVideoPlatform(),
  frame: null,
  classifier: "none",
});
const listeners = new Set<(result: LiveVideoIdentityResult) => void>();

function liveVideoPlatform(): LiveVideoIdentityPlatform {
  if (Platform.OS === "web") return "web";
  if (Platform.OS === "ios") return "ios";
  return "android";
}

function classifier() {
  if (isLiveVideoNativeAvailable()) return "yolo_identity" as const;
  return __DEV__ ? "mock" : "none";
}

function publishResult(raw: LiveVideoIdentityResult) {
  recentHits = [...recentHits, raw].slice(-LIVE_IDENTITY_STABLE_HITS);
  latest = stabilizeLiveIdentity(recentHits);
  for (const listener of listeners) listener(latest);
  void publishLivestreamHud({ scannerOn: running, identity: latest });
}

function publish(frame: LiveVideoFrame | null) {
  publishResult(
    identifyLiveVideo({
      scannerOn: running,
      platform: liveVideoPlatform(),
      frame,
      classifier: classifier(),
    }),
  );
}

async function pollNativeFrame() {
  if (!running || mockFrame || pollInFlight) return;
  pollInFlight = true;
  try {
    const frame = await pullLiveVideoSampleBuffer();
    if (!running) return;
    if (frame?.cardDetected && (frame.identityHash || frame.classifiedTcgdexId)) {
      try {
        const response = await identifyLivestreamFrame({
          source: "live_video",
          platform: liveVideoPlatform(),
          cardDetected: true,
          classifiedTcgdexId: frame.classifiedTcgdexId ?? null,
          identityHash: frame.identityHash ?? null,
          identityCropJpeg: frame.identityCropJpeg ?? null,
        });
        if (!running) return;
        publishResult(response.identity);
        return;
      } catch {
        if (!running) return;
        publish({
          source: "live_video",
          cardDetected: true,
          classifiedTcgdexId: null,
          identityHash: null,
        });
        return;
      }
    }
    publish(frame);
  } finally {
    pollInFlight = false;
  }
}

function startPolling() {
  if (pollTimer || !isLiveVideoNativeAvailable()) return;
  pollTimer = setInterval(() => {
    void pollNativeFrame();
  }, FRAME_POLL_MS);
}

function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

export function isLiveVideoIdentifyRunning(): boolean {
  return running;
}

export function getLiveVideoIdentity(): LiveVideoIdentityResult {
  return latest;
}

export function subscribeLiveVideoIdentity(
  listener: (result: LiveVideoIdentityResult) => void,
): () => void {
  listeners.add(listener);
  listener(latest);
  return () => {
    listeners.delete(listener);
  };
}

/** Playlist the live page already requested. Played only while the scanner is on. */
export function noteLiveHlsUrl(url: string | null): void {
  const next = normalizeLiveHlsUrl(url);
  if (!next || next === pendingHlsUrl) return;
  pendingHlsUrl = next;
  if (running) void setLiveVideoPlaybackUrl(next);
}

export function startLiveVideoIdentify(): void {
  running = true;
  recentHits = [];
  void setLiveVideoScannerSession(true);
  if (pendingHlsUrl) void setLiveVideoPlaybackUrl(pendingHlsUrl);
  startPolling();
  publish(mockFrame);
}

export function stopLiveVideoIdentify(): void {
  running = false;
  mockFrame = null;
  recentHits = [];
  stopPolling();
  void setLiveVideoPlaybackUrl(null);
  void setLiveVideoScannerSession(false);
  publish(null);
}

/** DEV/CI only: a live-video frame with a card in view. Never a WebView screenshot. */
export function injectMockLiveVideoCard(tcgdexId: string): LiveVideoIdentityResult {
  if (!running) return latest;
  mockFrame = mockLiveVideoFrame(tcgdexId);
  publish(mockFrame);
  publish(mockFrame);
  return latest;
}

export function clearMockLiveVideoCard(): void {
  mockFrame = null;
  if (running) publish(null);
}
