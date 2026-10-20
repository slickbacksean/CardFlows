/**
 * Frame-source-agnostic change gate + IoU tracks for the livestream scanner.
 * Works for HLS viewer frames or a future phone-camera "second screen" mode:
 * input is only boxes + crop hashes, never a URL or player type.
 * Shows usually present one card at a time; up to maxTracks (default 3) for
 * multi-card shots. One vendor/model match per track until a recheck is due.
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
  /** Same track when IoU with a live track is at least this. */
  iouThreshold?: number;
  /** Crop counts as unchanged when its pHash differs by at most this many bits (of 105). */
  hashUnchangedBits?: number;
  /** Remember this many crop hashes so a returning card does not rematch. */
  seenHashCap?: number;
  /** Concurrent tracks for multi-card shots (P1: up to 3). */
  maxTracks?: number;
  /**
   * After a lock, recheck the match this often (ms), or sooner on a large hash jump.
   * Named recheckAfterMs so callers stay explicit about the cadence.
   */
  recheckAfterMs?: number;
  /** Drop a track that has not been seen for this long (ms). */
  lostAfterMs?: number;
  /** Hash distance that forces a recheck even before recheckAfterMs. */
  hashJumpBits?: number;
  /**
   * Server identify calls allowed on a new track before it locks (P1 3-frame vote).
   * After this many noteMatch calls the track is locked until recheckAfterMs.
   */
  votesBeforeLock?: number;
}

export type LiveTrackDecision =
  | { action: "match"; reason: "new_track" | "no_box" | "recheck" }
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
  maxTracks: 3,
  recheckAfterMs: 2500,
  lostAfterMs: 1500,
  hashJumpBits: 18,
  votesBeforeLock: 3,
};

interface TrackState {
  id: number;
  box: LiveCardBox | null;
  lastMatchedHash: string | null;
  matched: boolean;
  locked: boolean;
  identifyCount: number;
  tcgdexId: string | null;
  lastSeenMs: number;
  lastMatchMs: number;
}

interface SeenCrop {
  hash: string;
  tcgdexId: string | null;
}

export function createLiveCardTracker(options: LiveCardTrackOptions = {}) {
  const opts = { ...LIVE_TRACK_DEFAULTS, ...options };
  const tracks: TrackState[] = [];
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

  function pruneLost(nowMs: number) {
    for (let i = tracks.length - 1; i >= 0; i--) {
      if (nowMs - tracks[i]!.lastSeenMs > opts.lostAfterMs) tracks.splice(i, 1);
    }
  }

  function findTrack(frame: LiveTrackFrame): TrackState | null {
    let best: TrackState | null = null;
    let bestIou = opts.iouThreshold;
    if (frame.box) {
      for (const track of tracks) {
        if (!track.box) continue;
        const iou = boxIou(frame.box, track.box);
        if (iou >= bestIou) {
          best = track;
          bestIou = iou;
        }
      }
      if (best) return best;
    }
    // Old native build without boxes: fall back to the crop hash alone.
    if (!frame.box) {
      for (const track of tracks) {
        if (track.box) continue;
        if (bitHashDistance(frame.hash, track.lastMatchedHash) <= opts.hashUnchangedBits * 3) {
          return track;
        }
      }
    }
    return null;
  }

  function openTrack(frame: LiveTrackFrame, remembered: SeenCrop | null): TrackState {
    while (tracks.length >= opts.maxTracks) tracks.shift();
    const track: TrackState = {
      id: nextId++,
      box: frame.box,
      lastMatchedHash: remembered?.hash ?? null,
      matched: Boolean(remembered),
      locked: Boolean(remembered?.tcgdexId),
      identifyCount: remembered ? opts.votesBeforeLock : 0,
      tcgdexId: remembered?.tcgdexId ?? null,
      lastSeenMs: frame.nowMs,
      lastMatchMs: remembered ? frame.nowMs : 0,
    };
    tracks.push(track);
    return track;
  }

  function needsRecheck(track: TrackState, frame: LiveTrackFrame): boolean {
    if (!track.matched) return false;
    if (frame.nowMs - track.lastMatchMs >= opts.recheckAfterMs) return true;
    if (
      frame.hash &&
      track.lastMatchedHash &&
      bitHashDistance(frame.hash, track.lastMatchedHash) >= opts.hashJumpBits
    ) {
      return true;
    }
    return false;
  }

  return {
    /** Decide whether this detected-card frame needs a server match. */
    decide(frame: LiveTrackFrame): LiveTrackDecision {
      pruneLost(frame.nowMs);
      const remembered = lookupHash(frame.hash);
      let track = findTrack(frame);
      if (!track) {
        track = openTrack(frame, remembered);
        if (remembered) {
          return { action: "skip", reason: "same_crop", tcgdexId: remembered.tcgdexId };
        }
        return { action: "match", reason: frame.box ? "new_track" : "no_box" };
      }
      track.box = frame.box ?? track.box;
      track.lastSeenMs = frame.nowMs;
      if (track.locked && needsRecheck(track, frame)) {
        return { action: "match", reason: "recheck" };
      }
      if (track.locked) {
        return { action: "skip", reason: "already_matched", tcgdexId: track.tcgdexId };
      }
      // Still gathering sharp-frame votes for this track.
      if (track.identifyCount > 0 && track.identifyCount < opts.votesBeforeLock) {
        // Only skip a byte-identical crop; near-hashes still count as another vote frame.
        if (frame.hash && track.lastMatchedHash && frame.hash === track.lastMatchedHash) {
          return { action: "skip", reason: "same_crop", tcgdexId: track.tcgdexId };
        }
        return { action: "match", reason: frame.box ? "new_track" : "no_box" };
      }
      if (remembered) {
        track.matched = true;
        track.locked = Boolean(remembered.tcgdexId);
        track.identifyCount = opts.votesBeforeLock;
        track.tcgdexId = remembered.tcgdexId;
        track.lastMatchedHash = remembered.hash;
        track.lastMatchMs = frame.nowMs;
        return { action: "skip", reason: "same_crop", tcgdexId: remembered.tcgdexId };
      }
      if (track.matched) {
        return { action: "skip", reason: "already_matched", tcgdexId: track.tcgdexId };
      }
      return { action: "match", reason: frame.box ? "new_track" : "no_box" };
    },
    /** Record the server's answer for the current track. Counts as the one match (until recheck). */
    noteMatch(input: { hash: string | null; tcgdexId: string | null; nowMs: number }) {
      const track = tracks[tracks.length - 1];
      if (!track) return;
      // Prefer the track that best matches this hash/box context (last seen).
      let target = track;
      for (const candidate of tracks) {
        if (
          input.hash &&
          bitHashDistance(input.hash, candidate.lastMatchedHash) <= opts.hashUnchangedBits * 3
        ) {
          target = candidate;
          break;
        }
        if (candidate.lastSeenMs >= target.lastSeenMs) target = candidate;
      }
      target.lastMatchedHash = input.hash;
      target.matched = true;
      target.identifyCount += 1;
      target.tcgdexId = input.tcgdexId ?? target.tcgdexId;
      target.lastMatchMs = input.nowMs;
      target.lastSeenMs = input.nowMs;
      remember(input.hash, target.tcgdexId);
      if (target.identifyCount >= opts.votesBeforeLock) {
        target.locked = true;
      }
    },
    /** No card in view: end all tracks. Crop hashes stay so the same crop is not rematched. */
    reset() {
      tracks.length = 0;
    },
    current(): Readonly<{ id: number; tcgdexId: string | null; matched: boolean; locked: boolean }> | null {
      const track = tracks[tracks.length - 1];
      if (!track) return null;
      return { id: track.id, tcgdexId: track.tcgdexId, matched: track.matched, locked: track.locked };
    },
    activeTracks(): ReadonlyArray<{ id: number; tcgdexId: string | null; matched: boolean; locked: boolean }> {
      return tracks.map((t) => ({
        id: t.id,
        tcgdexId: t.tcgdexId,
        matched: t.matched,
        locked: t.locked,
      }));
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
 * Replay a recorded stream of detector frames. Empty frames (no box, no hash) end the tracks.
 * `identify` is the vendor/model call — at most once per track until a recheck is due.
 * Frame-source agnostic: works for HLS or camera clips.
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
