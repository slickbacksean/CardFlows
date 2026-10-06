import type { RecognitionConfidence } from "./types";

/** Combined in-stream pipeline. Not Capture OBB/pHash. Not CardSight. */
export const LIVESTREAM_IDENTIFY_PIPELINE = "yolo_identity" as const;

export const LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE =
  "Livestream works in the iOS and Android app." as const;

export type LiveVideoIdentityPlatform = "ios" | "android" | "web";

/** Only live video sample buffers. Never a WebView still or Capture jpeg. */
export type LiveVideoFrameSource = "live_video";

export type LiveVideoClassifier = "mock" | "yolo_identity" | "none";

/** Native identity crop packed as RGB, then hashed with the English pHash index. */
export const LIVE_VIDEO_IDENTITY_RGB_SIZE = 24;
export const LIVE_VIDEO_IDENTITY_RGB_BYTES =
  LIVE_VIDEO_IDENTITY_RGB_SIZE * LIVE_VIDEO_IDENTITY_RGB_SIZE * 3;
/** Same bit count as RGB DCT pHash (`(6×6 − 1) × 3`). */
export const LIVE_VIDEO_IDENTITY_HASH_BITS = 105;

export type LiveVideoIdentityReason =
  | "scanner_off"
  | "unavailable"
  | "no_card"
  | "unidentified"
  | "identified";

export interface LiveVideoFrame {
  source: LiveVideoFrameSource;
  /** YOLO detect stage: a card is visible in the live video. */
  cardDetected: boolean;
  /**
   * Identity stage output from the combined model (or a mock classifier).
   * Absent/invalid means unidentified — never invent a catalog id.
   */
  classifiedTcgdexId?: string | null;
  /**
   * RGB pHash of the native live-video card crop. Metadata only — never a page jpeg.
   * The API matches this against the gitignored English index.
   */
  identityHash?: string | null;
  /**
   * Larger JPEG/PNG crop (base64) for the OpenCLIP livestream sidecar.
   * Never a full page screenshot. Optional; pHash remains the fallback.
   */
  identityCropJpeg?: string | null;
}

export interface LiveVideoIdentityInput {
  scannerOn: boolean;
  platform: LiveVideoIdentityPlatform;
  frame: LiveVideoFrame | null;
  /**
   * `none` until Ultralytics AGPL weights are licensed and shipped.
   * Mock/CI may use `mock` with an explicit classified id on a live-video frame.
   */
  classifier?: LiveVideoClassifier;
}

export interface LiveVideoIdentityResult {
  tcgdexId: string | null;
  confidence: RecognitionConfidence | null;
  reason: LiveVideoIdentityReason;
  pipeline: typeof LIVESTREAM_IDENTIFY_PIPELINE;
}

const ENGLISH_TCGDEX_ID = /^[a-z0-9]+-\d+[a-z0-9]*$/i;

export function isLiveVideoIdentityAvailable(
  platform: LiveVideoIdentityPlatform,
): boolean {
  return platform === "ios" || platform === "android";
}

export function normalizeLiveVideoTcgdexId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!ENGLISH_TCGDEX_ID.test(trimmed)) return null;
  return trimmed;
}

export function normalizeLiveVideoIdentityHash(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const hash = value.trim();
  if (hash.length !== LIVE_VIDEO_IDENTITY_HASH_BITS || !/^[01]+$/.test(hash)) return null;
  return hash;
}

/**
 * Prefer an explicit classified id (CI / native head). Otherwise the API-matched hash id.
 * Never invents a catalog id.
 */
export function classifiedTcgdexIdFromLiveVideoMetadata(input: {
  classifiedTcgdexId?: string | null;
  identityHash?: string | null;
  matchedTcgdexId?: string | null;
}): string | null {
  const explicit = normalizeLiveVideoTcgdexId(input.classifiedTcgdexId);
  if (explicit) return explicit;
  if (!normalizeLiveVideoIdentityHash(input.identityHash)) return null;
  return normalizeLiveVideoTcgdexId(input.matchedTcgdexId);
}

function emptyResult(reason: Exclude<LiveVideoIdentityReason, "identified">): LiveVideoIdentityResult {
  return {
    tcgdexId: null,
    confidence: null,
    reason,
    pipeline: LIVESTREAM_IDENTIFY_PIPELINE,
  };
}

/**
 * Combined YOLO detect + card-identity classify on a live-video frame.
 * Scanner off, web, no card, missing weights, or a bad id → no catalog id.
 */
export function identifyLiveVideo(input: LiveVideoIdentityInput): LiveVideoIdentityResult {
  if (!input.scannerOn) return emptyResult("scanner_off");
  if (!isLiveVideoIdentityAvailable(input.platform)) return emptyResult("unavailable");
  const frame = input.frame;
  if (!frame || frame.source !== "live_video" || !frame.cardDetected) {
    return emptyResult("no_card");
  }
  const classifier = input.classifier ?? "none";
  if (classifier === "none") return emptyResult("unidentified");
  const tcgdexId = normalizeLiveVideoTcgdexId(frame.classifiedTcgdexId);
  if (!tcgdexId) return emptyResult("unidentified");
  return {
    tcgdexId,
    confidence: "High",
    reason: "identified",
    pipeline: LIVESTREAM_IDENTIFY_PIPELINE,
  };
}

export function mockLiveVideoFrame(tcgdexId: string): LiveVideoFrame {
  return {
    source: "live_video",
    cardDetected: true,
    classifiedTcgdexId: tcgdexId,
  };
}

/** Same id on N consecutive live-video frames before the overlay treats it as stable. */
export const LIVE_IDENTITY_STABLE_HITS = 2;

export function stabilizeLiveIdentity(
  hits: readonly LiveVideoIdentityResult[],
  requiredHits: number = LIVE_IDENTITY_STABLE_HITS,
): LiveVideoIdentityResult {
  const last = hits[hits.length - 1];
  if (!last) return emptyResult("no_card");
  if (last.reason !== "identified" || !last.tcgdexId) return last;
  const window = hits.slice(-requiredHits);
  if (
    window.length >= requiredHits &&
    window.every((hit) => hit.reason === "identified" && hit.tcgdexId === last.tcgdexId)
  ) {
    return last;
  }
  return emptyResult("unidentified");
}
