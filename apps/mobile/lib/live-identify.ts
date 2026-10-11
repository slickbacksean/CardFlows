/**
 * Livestream scanner session. Combined YOLO + card-identity on live-video
 * sample buffers — never a page still, never Capture jpeg.
 * Do not snapshot the live page or POST a still.
 * Ultralytics weights stay gitignored until CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED.
 * Identity is live_video metadata (`identityHash`) → POST /v1/livestream/identify.
 */
import { Platform } from "react-native";
import {
  createLiveCardTracker,
  createLiveScanTimingLog,
  identifyLiveVideo,
  LIVE_IDENTITY_STABLE_HITS,
  mockLiveVideoFrame,
  normalizeLiveHlsUrl,
  stabilizeLiveIdentity,
  type LiveScanSample,
  type LiveScanSummary,
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
// (MPS, warm). The poll used to be 800 ms so frames dropped instead of queueing.
// Now an IoU track + crop-hash gate sends a frame only for a new card, a
// pending/unstable identity, or a periodic re-confirm, so detection can run
// faster without more server load. pollInFlight still drops ticks.
const FRAME_POLL_MS = 350;

/**
 * Debug-only per-stage timing on the phone. Off unless
 * EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TIMING=1 (never set in production profiles).
 */
const TIMING_ENABLED = process.env.EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TIMING === "1";
const timingLog = createLiveScanTimingLog(300);
const tracker = createLiveCardTracker();

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function noteTiming(sample: LiveScanSample) {
  if (!TIMING_ENABLED) return;
  timingLog.add(sample);
  console.info(`[livestream-timing] ${JSON.stringify(sample)}`);
}

/** Debug: p50/p95 per stage of this session's frames (empty unless timing is on). */
export function getLiveScanTimingSummary(): LiveScanSummary {
  return timingLog.summary();
}

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
    const pullStart = nowMs();
    const frame = await pullLiveVideoSampleBuffer();
    const pullMs = nowMs() - pullStart;
    if (!running) return;
    if (frame?.cardDetected && (frame.identityHash || frame.classifiedTcgdexId)) {
      const decision = tracker.decide({
        box: frame.cardBox ?? null,
        hash: frame.identityHash ?? null,
        nowMs: Date.now(),
      });
      if (decision.action === "skip") {
        // Same card, already stable (or an unchanged rejected crop): keep the
        // current identity on screen and send nothing.
        noteTiming({
          stages: { detect: frame.detectMs ?? undefined, pull: pullMs },
          outcome: "skipped",
        });
        return;
      }
      const requestStart = nowMs();
      try {
        const response = await identifyLivestreamFrame({
          source: "live_video",
          platform: liveVideoPlatform(),
          cardDetected: true,
          classifiedTcgdexId: frame.classifiedTcgdexId ?? null,
          identityHash: frame.identityHash ?? null,
          identityCropJpeg: frame.identityCropJpeg ?? null,
          identityCropQuad: frame.identityCropQuad ?? null,
        });
        const roundTripMs = nowMs() - requestStart;
        if (!running) return;
        tracker.noteMatch({
          hash: frame.identityHash ?? null,
          tcgdexId: response.identity.reason === "identified" ? response.identity.tcgdexId : null,
          nowMs: Date.now(),
        });
        const server = response.timing?.stages ?? {};
        noteTiming({
          stages: {
            ...server,
            detect: frame.detectMs ?? undefined,
            pull: pullMs,
            // Network + JSON both ways: the round trip minus server time.
            upload:
              typeof server.server === "number" ? Math.max(0, roundTripMs - server.server) : undefined,
            total: pullMs + roundTripMs,
          },
          outcome: response.identity.reason === "identified" ? "accepted" : "rejected",
          warped: response.timing?.warped,
        });
        publishResult(response.identity);
        return;
      } catch {
        noteTiming({ stages: { pull: pullMs, total: nowMs() - pullStart }, outcome: "error" });
        tracker.noteMatch({ hash: null, tcgdexId: null, nowMs: Date.now() });
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
    tracker.reset();
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
  tracker.reset();
  timingLog.clear();
  void setLiveVideoScannerSession(true);
  if (pendingHlsUrl) void setLiveVideoPlaybackUrl(pendingHlsUrl);
  startPolling();
  publish(mockFrame);
}

export function stopLiveVideoIdentify(): void {
  running = false;
  mockFrame = null;
  recentHits = [];
  tracker.reset();
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
