/**
 * Phone-side change gate + simple IoU track for the livestream scanner.
 * One card at a time in most shows, so a single track is enough (no ByteTrack).
 * One vendor/model match per tracked card. The same crop hash is never matched twice.
 */

/** Normalized [0, 1] box, top-left origin. */
export interface LiveCardBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function normalizeLiveCardBox(raw: unknown): LiveCardBox | null {
  if (!raw || typeof raw !== "object") return null;
  const box = raw as Record<string, unknown>;
  const values = [box.x, box.y, box.width, box.height];
  if (!values.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const [x, y, width, height] = values as number[];
  if (width! <= 0 || height! <= 0 || x! < -0.01 || y! < -0.01) return null;
  if (x! + width! > 1.01 || y! + height! > 1.01) return null;
  return { x: x!, y: y!, width: width!, height: height! };
}

export function boxIou(a: LiveCardBox, b: LiveCardBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/** Hamming distance of two equal-length bit strings; Infinity if not comparable. */
export function bitHashDistance(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) distance += 1;
  return distance;
}

export interface LiveCardTrackOptions {
  /** Same track when IoU with the last box is at least this. */
  iouThreshold?: number;
  /** Crop counts as unchanged when its pHash differs by at most this many bits (of 105). */
  hashUnchangedBits?: number;
  /** Remember this many crop hashes so a returning card does not rematch. */
  seenHashCap?: number;
}

export type LiveTrackDecision =
  | { action: "match"; reason: "new_track" | "no_box" }
  | { action: "skip"; reason: "already_matched" | "same_crop"; tcgdexId: string | null };

export interface LiveTrackFrame {
  box: LiveCardBox | null;
  hash: string | null;
  nowMs: number;
}

export const LIVE_TRACK_DEFAULTS: Required<LiveCardTrackOptions> = {
  iouThreshold: 0.5,
  hashUnchangedBits: 6,
  seenHashCap: 32,
};

interface TrackState {
  id: number;
  box: LiveCardBox | null;
  lastMatchedHash: string | null;
  matched: boolean;
  tcgdexId: string | null;
}

interface SeenCrop {
  hash: string;
  tcgdexId: string | null;
}

export function createLiveCardTracker(options: LiveCardTrackOptions = {}) {
  const opts = { ...LIVE_TRACK_DEFAULTS, ...options };
  let track: TrackState | null = null;
  let nextId = 1;
  const seen: SeenCrop[] = [];

  function lookupHash(hash: string | null): SeenCrop | null {
    if (!hash) return null;
    let best: SeenCrop | null = null;
    let bestDist = opts.hashUnchangedBits;
    for (const entry of seen) {
      const dist = bitHashDistance(hash, entry.hash);
      if (dist <= bestDist) {
        best = entry;
        bestDist = dist;
      }
    }
    return best;
  }

  function remember(hash: string | null, tcgdexId: string | null) {
    if (!hash) return;
    const existing = lookupHash(hash);
    if (existing) {
      existing.tcgdexId = tcgdexId;
      return;
    }
    seen.push({ hash, tcgdexId });
    if (seen.length > opts.seenHashCap) seen.splice(0, seen.length - opts.seenHashCap);
  }

  return {
    /** Decide whether this detected-card frame needs a server match. */
    decide(frame: LiveTrackFrame): LiveTrackDecision {
      const remembered = lookupHash(frame.hash);
      const sameTrack =
        track !== null &&
        (frame.box && track.box
          ? boxIou(frame.box, track.box) >= opts.iouThreshold
          : // Old native build without boxes: fall back to the crop hash alone.
            !frame.box && !track.box &&
            bitHashDistance(frame.hash, track.lastMatchedHash) <= opts.hashUnchangedBits * 3);
      if (!sameTrack || !track) {
        track = {
          id: nextId++,
          box: frame.box,
          lastMatchedHash: remembered?.hash ?? null,
          matched: Boolean(remembered),
          tcgdexId: remembered?.tcgdexId ?? null,
        };
        if (remembered) {
          return { action: "skip", reason: "same_crop", tcgdexId: remembered.tcgdexId };
        }
        return { action: "match", reason: frame.box ? "new_track" : "no_box" };
      }
      track.box = frame.box ?? track.box;
      if (track.matched) {
        return { action: "skip", reason: "already_matched", tcgdexId: track.tcgdexId };
      }
      if (remembered) {
        track.matched = true;
        track.tcgdexId = remembered.tcgdexId;
        track.lastMatchedHash = remembered.hash;
        return { action: "skip", reason: "same_crop", tcgdexId: remembered.tcgdexId };
      }
      return { action: "match", reason: frame.box ? "new_track" : "no_box" };
    },
    /** Record the server's answer for the current track. Counts as the one match. */
    noteMatch(input: { hash: string | null; tcgdexId: string | null; nowMs: number }) {
      if (!track) return;
      track.lastMatchedHash = input.hash;
      track.matched = true;
      track.tcgdexId = input.tcgdexId;
      remember(input.hash, input.tcgdexId);
    },
    /** No card in view: end the track. Crop hashes stay so the same crop is not rematched. */
    reset() {
      track = null;
    },
    current(): Readonly<{ id: number; tcgdexId: string | null; matched: boolean }> | null {
      if (!track) return null;
      return { id: track.id, tcgdexId: track.tcgdexId, matched: track.matched };
    },
  };
}

export type LiveCardTracker = ReturnType<typeof createLiveCardTracker>;

export interface LiveStreamReplayFrame extends LiveTrackFrame {
  expectedId: string | null;
}

export interface LiveStreamReplayResult {
  matchCalls: number;
  callsByTrack: Record<number, number>;
  identified: number;
  frames: number;
  matchRate: number;
  maxCallsPerTrack: number;
}

/**
 * Replay a recorded stream of detector frames. Empty frames (no box, no hash) end the track.
 * `identify` is the vendor/model call — it must run at most once per tracked card.
 */
export function replayLiveCardStream(
  frames: readonly LiveStreamReplayFrame[],
  identify: (frame: LiveStreamReplayFrame) => string | null,
): LiveStreamReplayResult {
  const tracker = createLiveCardTracker();
  const callsByTrack: Record<number, number> = {};
  let matchCalls = 0;
  let identified = 0;
  let scored = 0;
  for (const frame of frames) {
    if (!frame.box && !frame.hash) {
      tracker.reset();
      continue;
    }
    scored += 1;
    const decision = tracker.decide(frame);
    const trackId = tracker.current()?.id ?? 0;
    let tcgdexId: string | null = null;
    if (decision.action === "match") {
      matchCalls += 1;
      callsByTrack[trackId] = (callsByTrack[trackId] ?? 0) + 1;
      tcgdexId = identify(frame);
      tracker.noteMatch({ hash: frame.hash, tcgdexId, nowMs: frame.nowMs });
    } else {
      tcgdexId = decision.tcgdexId;
    }
    if (frame.expectedId && tcgdexId === frame.expectedId) identified += 1;
  }
  const callCounts = Object.values(callsByTrack);
  return {
    matchCalls,
    callsByTrack,
    identified,
    frames: scored,
    matchRate: scored ? identified / scored : 0,
    maxCallsPerTrack: callCounts.length ? Math.max(...callCounts) : 0,
  };
}
