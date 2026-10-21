/**
 * Livestream scanner session. Combined YOLO + card-identity on live-video
 * sample buffers — never a page still, never Capture jpeg.
 * Do not snapshot the live page or POST a still.
 * Ultralytics weights stay gitignored until CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED.
 * Identity is live_video metadata (`identityHash`) → POST /v1/livestream/identify.
 */
import { Platform } from "react-native";
import {
  createLiveAnnounceDedupe,
  createLiveCardTracker,
  createLiveIdentityVoter,
  createLiveScanTimingLog,
  identifyLiveVideo,
  LIVE_IDENTITY_STABLE_HITS,
  LIVE_SCAN_ID_BUDGET_MS,
  LIVE_SCAN_STEADY_MS,
  mockLiveVideoFrame,
  normalizeLiveHlsUrl,
  stabilizeLiveIdentity,
  type LiveScanSample,
  type LiveScanSummary,
  type LiveVideoFrame,
  type LiveVideoIdentityPlatform,
  type LiveVideoIdentityResult,
  type LiveVoteResult,
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
// An IoU track + crop-hash gate (below) matches once per tracked card until a
// recheck is due, so the faster poll does not add server load.
// TODO(P1/P2): prefer native push frames from cardflow-live-video when available
// instead of this 250 ms JS poll (see live-video-native.ts).
const FRAME_POLL_MS = 250;

/**
 * Debug-only per-stage timing on the phone. Off unless
 * EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TIMING=1 (never set in production profiles).
 */
const TIMING_ENABLED = process.env.EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TIMING === "1";
const timingLog = createLiveScanTimingLog(300);
/** Up to 3 IoU tracks; one vendor/model match per tracked card until recheck. */
const tracker = createLiveCardTracker();
/** Vote across 3 sharp identify results before auto-showing a match. */
const voter = createLiveIdentityVoter();
/** Do not re-announce the same card within 60 s. */
const announceDedupe = createLiveAnnounceDedupe();
let latestVote: LiveVoteResult | null = null;
/**
 * Sean (Oct 21): quiet "try one card at a time" when CardSight sees several cards or a
 * non-English card. Never a guess, never a pick-one prompt.
 */
let latestHint: "one_card_at_a_time" | null = null;
/**
 * Sean (Oct 21): a card must be identified within ~7 s of appearing. The only wait before the first
 * send is a short frame-change check (seen in 2 polls, LIVE_SCAN_STEADY_MS); then the server answers
 * with in-house (if confident) or CardSight right away.
 */
let cardAppearedAt: number | null = null;
let cardTimedOut = false;
/** Per scanner session (server rate-limits CardSight per session). */
let sessionId: string | null = null;

/** Quiet hint for the HUD, or null. */
export function getLiveScanHint(): "one_card_at_a_time" | null {
  return latestHint;
}

/** Card appears → result shown, per engine. Logged with the timing flag; always sent to perf stats. */
function noteCardToResult(engine: string) {
  if (cardAppearedAt == null || cardTimedOut) return;
  const ms = Date.now() - cardAppearedAt;
  cardTimedOut = true; // one sample per card
  recordPerfStage(engine === "in_house" ? "live_card_to_result_in_house" : "live_card_to_result_cardsight", ms);
  if (ms > LIVE_SCAN_ID_BUDGET_MS) recordPerfStage("live_card_to_result_over_budget", ms);
  if (TIMING_ENABLED) console.info(`[livestream-card-to-result] ${JSON.stringify({ engine, ms })}`);
}

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

/** Latest vote tier (auto_show / pick_one / waiting) for the HUD. */
export function getLiveIdentityVote(): LiveVoteResult | null {
  return latestVote;
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

function publishResult(raw: LiveVideoIdentityResult, vote?: LiveVoteResult | null) {
  if (vote) latestVote = vote;
  recentHits = [...recentHits, raw].slice(-LIVE_IDENTITY_STABLE_HITS);
  const stabilized = stabilizeLiveIdentity(recentHits);
  if (
    stabilized.reason === "identified" &&
    stabilized.tcgdexId &&
    !announceDedupe.shouldAnnounce(stabilized.tcgdexId, Date.now())
  ) {
    // Same card within 60 s: keep HUD quiet (still update listeners for state).
    latest = stabilized;
    for (const listener of listeners) listener(latest);
    return;
  }
  if (stabilized.reason === "identified" && stabilized.tcgdexId) {
    announceDedupe.noteAnnounced(stabilized.tcgdexId, Date.now());
  }
  latest = stabilized;
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
      // Where the crop sits in the frame, so the server can black out Whatnot chat / bid areas.
      cardBox: frame.cardBox ?? null,
      sessionId,
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
    const matchMs =
      typeof server.match === "number"
        ? server.match
        : typeof server.search === "number"
          ? server.search
          : typeof server.sidecar === "number"
            ? server.sidecar
            : undefined;
    noteTiming({
      stages: {
        ...server,
        detect: frame.detectMs ?? undefined,
        pull: pullMs,
        // Network + JSON both ways: the round trip minus server time.
        upload: typeof server.server === "number" ? Math.max(0, roundTripMs - server.server) : undefined,
        match: matchMs,
        total: pullMs + roundTripMs,
      },
      outcome: response.identity.reason === "identified" ? "accepted" : "rejected",
      warped: response.timing?.warped,
    });
    if ((response as { source?: string }).source === "cardsight") {
      // Sean (Oct 21): CardSight already gated Medium/High on the server. Show it as-is, or nothing.
      latestHint = (response as { hint?: "one_card_at_a_time" }).hint ?? null;
      latestVote = null;
      if (response.identity.reason === "identified" && response.identity.tcgdexId) {
        missedCards = 0;
        settledKey = key;
        latestHint = null;
        noteCardToResult((response as { engine?: string }).engine ?? "cardsight");
        publishResult(response.identity);
        return;
      }
      if (keepSettledIdentity(key)) {
        publishResult(latest);
        return;
      }
      if (response.identity.reason === "no_card" && latest.reason === "identified") {
        missedCards += 1;
        if (missedCards < MISS_LIMIT) {
          publishResult(latest);
          return;
        }
      }
      publishResult({ ...response.identity, tcgdexId: null, confidence: null });
      return;
    }
    if (response.identity.reason === "identified" || response.identity.reason === "unidentified") {
      const extra = response as {
        candidates?: { tcgdexId: string; similarity?: number }[];
        similarity?: number | null;
      };
      const vote = voter.add({
        tcgdexId: response.identity.reason === "identified" ? response.identity.tcgdexId : null,
        similarity: typeof extra.similarity === "number" ? extra.similarity : null,
        candidates: Array.isArray(extra.candidates) ? extra.candidates : null,
      });
      // Sean (Oct 21): no "is it one of these?" prompt. A pick-one tier just keeps waiting.
      latestVote = vote.tier === "pick_one" ? { ...vote, tier: "waiting", top3: [], copy: null } : vote;
      if (vote.tier === "auto_show" && vote.tcgdexId) {
        missedCards = 0;
        settledKey = key;
        publishResult(
          {
            ...response.identity,
            tcgdexId: vote.tcgdexId,
            reason: "identified",
            confidence: response.identity.confidence ?? "High",
          },
          vote,
        );
        return;
      }
      if (vote.tier === "pick_one" || vote.tier === "waiting") {
        // Keep looking; HUD reads vote via getLiveIdentityVote().
        publishResult(
          {
            tcgdexId: null,
            confidence: null,
            reason: "unidentified",
            pipeline: response.identity.pipeline,
          },
          latestVote,
        );
        if (response.identity.reason === "identified") {
          // Still remember the server hit for the track lock, but do not auto-show yet.
          settledKey = key;
        }
        return;
      }
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
    cardAppearedAt = null;
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
    if (cardAppearedAt == null) {
      cardAppearedAt = Date.now();
      cardTimedOut = false;
    }
    if (
      decision.action === "match" &&
      decision.reason === "new_track" &&
      Date.now() - cardAppearedAt < LIVE_SCAN_STEADY_MS
    ) {
      // Frame-change check only (~300 ms): a card that flicks past is never sent.
      return;
    }
    if (decision.action === "skip") {
      // Same tracked card, already matched, or a crop hash we already sent: no vendor/model call.
      noteTiming({ stages: { detect: frame.detectMs ?? undefined, pull: pullMs }, outcome: "skipped" });
      const current = tracker.current();
      if (
        decision.reason === "same_crop" &&
        decision.tcgdexId &&
        current &&
        !current.locked
      ) {
        // Static card: reuse the known id as another sharp-frame vote without a network call.
        const vote = voter.add({ tcgdexId: decision.tcgdexId, similarity: null });
        tracker.noteMatch({
          hash: frame.identityHash ?? null,
          tcgdexId: decision.tcgdexId,
          nowMs: Date.now(),
        });
        latestVote = vote;
        if (vote.tier === "auto_show" && vote.tcgdexId) {
          publishKnownIdentity(vote.tcgdexId);
        } else {
          publishResult(
            {
              tcgdexId: null,
              confidence: null,
              reason: "unidentified",
              pipeline: latest.pipeline,
            },
            vote,
          );
        }
        return;
      }
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
  cardAppearedAt = null;
  sessionId = `ls-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  latestHint = null;
  recentHits = [];
  settledKey = null;
  queuedFrame = null;
  missedCards = 0;
  identifyInFlight = false;
  tracker.reset();
  voter.reset();
  announceDedupe.clear();
  latestVote = null;
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
  sessionId = null;
  latestHint = null;
  mockFrame = null;
  recentHits = [];
  settledKey = null;
  queuedFrame = null;
  missedCards = 0;
  yoloDetect = false;
  identifyInFlight = false;
  tracker.reset();
  voter.reset();
  announceDedupe.clear();
  latestVote = null;
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
