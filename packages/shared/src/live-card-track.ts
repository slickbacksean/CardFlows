/**
 * Phone-side change gate + simple IoU track for the livestream scanner.
 * One card at a time in most shows, so a single track is enough (no ByteTrack).
 * Match once per track; re-match on a new track, while the identity is not yet
 * stable, when the crop changes while unstable, or every `reconfirmMs`.
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
  /** Re-confirm a stable track this often. */
  reconfirmMs?: number;
  /** Server hits with the same id before a track counts as stable. */
  stableHits?: number;
}

export type LiveTrackDecision =
  | { action: "match"; reason: "new_track" | "unstable" | "reconfirm" | "no_box" }
  | { action: "skip"; reason: "stable_track" | "unchanged_crop" };

export interface LiveTrackFrame {
  box: LiveCardBox | null;
  hash: string | null;
  nowMs: number;
}

export const LIVE_TRACK_DEFAULTS: Required<LiveCardTrackOptions> = {
  iouThreshold: 0.5,
  hashUnchangedBits: 6,
  reconfirmMs: 2500,
  stableHits: 2,
};

interface TrackState {
  id: number;
  box: LiveCardBox | null;
  lastMatchedHash: string | null;
  lastMatchMs: number;
  tcgdexId: string | null;
  hits: number;
}

export function createLiveCardTracker(options: LiveCardTrackOptions = {}) {
  const opts = { ...LIVE_TRACK_DEFAULTS, ...options };
  let track: TrackState | null = null;
  let nextId = 1;

  function stable(): boolean {
    return Boolean(track?.tcgdexId) && (track?.hits ?? 0) >= opts.stableHits;
  }

  return {
    /** Decide whether this detected-card frame needs a server match. */
    decide(frame: LiveTrackFrame): LiveTrackDecision {
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
          lastMatchedHash: null,
          lastMatchMs: 0,
          tcgdexId: null,
          hits: 0,
        };
        return { action: "match", reason: frame.box ? "new_track" : "no_box" };
      }
      track.box = frame.box ?? track.box;
      if (frame.nowMs - track.lastMatchMs >= opts.reconfirmMs) {
        return { action: "match", reason: "reconfirm" };
      }
      if (stable()) return { action: "skip", reason: "stable_track" };
      // A pending id (1 hit) needs its confirming match. Only a rejected crop
      // that has not changed is skipped: re-sending it would get the same answer.
      if (
        !track.tcgdexId &&
        bitHashDistance(frame.hash, track.lastMatchedHash) <= opts.hashUnchangedBits
      ) {
        return { action: "skip", reason: "unchanged_crop" };
      }
      return { action: "match", reason: "unstable" };
    },
    /** Record the server's answer for the current track. */
    noteMatch(input: { hash: string | null; tcgdexId: string | null; nowMs: number }) {
      if (!track) return;
      track.lastMatchedHash = input.hash;
      track.lastMatchMs = input.nowMs;
      if (input.tcgdexId && input.tcgdexId === track.tcgdexId) {
        track.hits += 1;
      } else {
        track.tcgdexId = input.tcgdexId;
        track.hits = input.tcgdexId ? 1 : 0;
      }
    },
    /** No card in view: end the track. */
    reset() {
      track = null;
    },
    current(): Readonly<{ id: number; tcgdexId: string | null; hits: number; stable: boolean }> | null {
      if (!track) return null;
      return { id: track.id, tcgdexId: track.tcgdexId, hits: track.hits, stable: stable() };
    },
  };
}

export type LiveCardTracker = ReturnType<typeof createLiveCardTracker>;
