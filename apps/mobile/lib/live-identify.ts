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
import { getHealth, identifyLivestreamFrame } from "./api";
import { recordPerfStage } from "./perf-telemetry";
import { publishLivestreamHud } from "./huds";
import {
  isLiveVideoNativeAvailable,
  pullLiveVideoSampleBuffer,
  setLiveVideoPlaybackUrl,
  setLiveVideoScannerSession,
  setLiveVideoYoloDetect,
} from "./live-video-native";

// Capture stays ahead of the match. OpenCLIP is ~630 ms, and a Whatnot lot
// often sells in about 7 seconds, so the next frame is not queued behind it.
// An IoU track + crop-hash gate (below) matches once per tracked card, so the
// faster poll does not add server load.
const FRAME_POLL_MS = 250;

/**
 * Debug-only per-stage timing on the phone. Off unless
 * EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TIMING=1 (never set in production profiles).
 */
const TIMING_ENABLED = process.env.EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TIMING === "1";
const timingLog = createLiveScanTimingLog(300);
/** One IoU track; one vendor/model match per tracked card, with crop-hash dedupe. */
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
let captureInFlight = false;
let identifyInFlight = false;
let settledKey: string | null = null;
/** Newest detected crop. Replaces anything still waiting so a slow miss cannot hide the card. */
let queuedFrame: { frame: LiveVideoFrame; key: string; pullMs: number } | null = null;
/** Keep a settled guess across brief detector dropouts (~1s at the poll interval). */
let missedCards = 0;
const MISS_LIMIT = 4;
/** True after /health says the API loaded YOLO for livestream frames. */
let yoloDetect = false;
let yoloTimer: ReturnType<typeof setInterval> | null = null;
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

function frameKey(frame: LiveVideoFrame): string | null {
  if (yoloDetect && frame.videoFrameJpeg) return `yolo:${frame.videoFrameJpeg.slice(-48)}`;
  if (frame.classifiedTcgdexId) return `id:${frame.classifiedTcgdexId}`;
  if (frame.identityHash) return `hash:${frame.identityHash}`;
  if (frame.identityCropJpeg) return `crop:${frame.identityCropJpeg.slice(-48)}`;
  return null;
}

async function refreshYoloDetect() {
  try {
    const health = await getHealth();
    yoloDetect = health.liveVideoYolo === true;
  } catch {
    yoloDetect = false;
  }
  if (running) void setLiveVideoYoloDetect(yoloDetect);
}

/** Compression noise flips a few pHash bits on the same card. 105-bit hash. */
const SAME_CARD_HASH_DISTANCE = 12;

function sameVisibleCard(left: string, right: string): boolean {
  if (left === right) return true;
  if (!left.startsWith("hash:") || !right.startsWith("hash:")) return false;
  const a = left.slice(5);
  const b = right.slice(5);
  if (a.length !== b.length || a.length === 0) return false;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) distance += 1;
    if (distance > SAME_CARD_HASH_DISTANCE) return false;
  }
  return true;
}

function keepSettledIdentity(key: string): boolean {
  return (
    latest.reason === "identified" &&
    settledKey != null &&
    sameVisibleCard(key, settledKey)
  );
}

function publishKnownIdentity(tcgdexId: string | null) {
  if (!tcgdexId) {
    if (latest.reason === "identified") publishResult(latest);
    return;
  }
  const kind = classifier();
  publishResult(
    identifyLiveVideo({
      scannerOn: running,
      platform: liveVideoPlatform(),
      frame: {
        source: "live_video",
        cardDetected: true,
        classifiedTcgdexId: tcgdexId,
      },
      classifier: kind === "none" ? "mock" : kind,
    }),
  );
}

function drainIdentify() {
  if (identifyInFlight || !queuedFrame || !running) return;
  const next = queuedFrame;
  queuedFrame = null;
  void identifyFrame(next.frame, next.key, next.pullMs);
}

async function identifyFrame(frame: LiveVideoFrame, key: string, pullMs: number) {
  identifyInFlight = true;
  const requestStart = nowMs();
  try {
    const response = await identifyLivestreamFrame({
      source: "live_video",
      platform: liveVideoPlatform(),
      cardDetected: frame.cardDetected,
      classifiedTcgdexId: frame.classifiedTcgdexId ?? null,
      identityHash: frame.identityHash ?? null,
      identityCropJpeg: frame.identityCropJpeg ?? null,
      // 4 corners in crop pixels; the sidecar warps with warp.py before matching.
      identityCropQuad: frame.identityCropQuad ?? null,
      videoFrameJpeg: yoloDetect ? (frame.videoFrameJpeg ?? null) : null,
    });
    const roundTripMs = nowMs() - requestStart;
    recordPerfStage("live_identify_round_trip", roundTripMs);
    recordPerfStage("live_frame_pull", pullMs);
    if (frame.detectMs != null) recordPerfStage("live_detect", frame.detectMs);
    recordPerfStage("live_frame_to_hud", pullMs + (frame.detectMs ?? 0) + roundTripMs);
    if (!running) return;
    if (frame.cardDetected) {
      tracker.noteMatch({
        hash: frame.identityHash ?? null,
        tcgdexId: response.identity.reason === "identified" ? response.identity.tcgdexId : null,
        nowMs: Date.now(),
      });
    }
    const server = response.timing?.stages ?? {};
    noteTiming({
      stages: {
        ...server,
        detect: frame.detectMs ?? undefined,
        pull: pullMs,
        // Network + JSON both ways: the round trip minus server time.
        upload: typeof server.server === "number" ? Math.max(0, roundTripMs - server.server) : undefined,
        total: pullMs + roundTripMs,
      },
      outcome: response.identity.reason === "identified" ? "accepted" : "rejected",
      warped: response.timing?.warped,
    });
    if (response.identity.reason === "identified") {
      missedCards = 0;
      settledKey = key;
      publishResult(response.identity);
      return;
    }
    if (response.identity.reason === "no_card" && latest.reason === "identified") {
      missedCards += 1;
      if (missedCards < MISS_LIMIT) {
        publishResult(latest);
        return;
      }
    }
    if (keepSettledIdentity(key)) {
      publishResult(latest);
      return;
    }
    publishResult(response.identity);
  } catch {
    noteTiming({ stages: { pull: pullMs, total: pullMs + nowMs() - requestStart }, outcome: "error" });
    if (frame.cardDetected) {
      tracker.noteMatch({ hash: frame.identityHash ?? null, tcgdexId: null, nowMs: Date.now() });
    }
    if (!running || keepSettledIdentity(key)) return;
    publish({
      source: "live_video",
      cardDetected: true,
      classifiedTcgdexId: null,
      identityHash: null,
    });
  } finally {
    identifyInFlight = false;
    drainIdentify();
  }
}

async function pollNativeFrame() {
  if (!running || mockFrame || captureInFlight) return;
  captureInFlight = true;
  let frame: LiveVideoFrame | null = null;
  const pullStart = nowMs();
  try {
    frame = await pullLiveVideoSampleBuffer();
  } finally {
    captureInFlight = false;
  }
  const pullMs = nowMs() - pullStart;
  if (!running) return;
  const yoloFrame = yoloDetect && frame?.videoFrameJpeg ? frame : null;
  const phoneCard = Boolean(frame?.cardDetected);
  const key = yoloFrame ? frameKey(yoloFrame) : phoneCard && frame ? frameKey(frame) : null;
  if (!key) {
    missedCards += 1;
    if (latest.reason === "identified" && missedCards < MISS_LIMIT) {
      publishResult(latest);
      return;
    }
    queuedFrame = null;
    tracker.reset();
    publish(frame);
    return;
  }
  if (phoneCard && frame) {
    missedCards = 0;
    const decision = tracker.decide({
      box: frame.cardBox ?? null,
      hash: frame.identityHash ?? null,
      nowMs: Date.now(),
    });
    if (decision.action === "skip") {
      // Same tracked card, already matched, or a crop hash we already sent: no vendor/model call.
      noteTiming({ stages: { detect: frame.detectMs ?? undefined, pull: pullMs }, outcome: "skipped" });
      if (decision.reason === "same_crop") publishKnownIdentity(decision.tcgdexId);
      else if (latest.reason === "identified") publishResult(latest);
      return;
    }
  }
  if (keepSettledIdentity(key)) {
    publishResult(latest);
    return;
  }
  if (latest.reason !== "identified") publish(frame);
  if (frame) queuedFrame = { frame, key, pullMs };
  drainIdentify();
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
  if (!isLiveVideoNativeAvailable()) {
    running = false;
    publish(null);
    return;
  }
  running = true;
  recentHits = [];
  settledKey = null;
  queuedFrame = null;
  missedCards = 0;
  identifyInFlight = false;
  tracker.reset();
  timingLog.clear();
  void setLiveVideoScannerSession(true);
  void refreshYoloDetect();
  if (!yoloTimer) {
    yoloTimer = setInterval(() => {
      if (running) void refreshYoloDetect();
    }, 8000);
  }
  if (pendingHlsUrl) void setLiveVideoPlaybackUrl(pendingHlsUrl);
  startPolling();
  publish(mockFrame);
}

export function stopLiveVideoIdentify(): void {
  running = false;
  mockFrame = null;
  recentHits = [];
  settledKey = null;
  queuedFrame = null;
  missedCards = 0;
  yoloDetect = false;
  identifyInFlight = false;
  tracker.reset();
  if (yoloTimer) {
    clearInterval(yoloTimer);
    yoloTimer = null;
  }
  void setLiveVideoYoloDetect(false);
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
