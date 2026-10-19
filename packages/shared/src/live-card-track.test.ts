import { describe, expect, it } from "vitest";
import {
  bitHashDistance,
  boxIou,
  createLiveCardTracker,
  normalizeLiveCardBox,
  replayLiveCardStream,
  type LiveStreamReplayFrame,
} from "./live-card-track";

const box = { x: 0.3, y: 0.2, width: 0.3, height: 0.42 };
const moved = { x: 0.31, y: 0.21, width: 0.3, height: 0.42 };
const elsewhere = { x: 0.0, y: 0.0, width: 0.2, height: 0.28 };
const hashA = "0".repeat(105);
const hashB = "1".repeat(105);

function cardHash(card: number, flip = 0): string {
  const bits = Array.from({ length: 105 }, () => "0");
  const origin = (card - 1) * 16;
  for (let i = 0; i < 16; i++) bits[origin + i] = "1";
  if (flip) bits[104] = flip % 2 === 0 ? "0" : "1";
  return bits.join("");
}

describe("live card track", () => {
  it("computes IoU and hash distance", () => {
    expect(boxIou(box, box)).toBeCloseTo(1);
    expect(boxIou(box, elsewhere)).toBe(0);
    expect(bitHashDistance(hashA, hashA)).toBe(0);
    expect(bitHashDistance(hashA, hashB)).toBe(105);
    expect(bitHashDistance(hashA, null)).toBe(Number.POSITIVE_INFINITY);
  });

  it("normalizes boxes and rejects junk", () => {
    expect(normalizeLiveCardBox(box)).toEqual(box);
    expect(normalizeLiveCardBox({ x: 0.9, y: 0, width: 0.5, height: 0.5 })).toBeNull();
    expect(normalizeLiveCardBox({ x: "a" })).toBeNull();
    expect(normalizeLiveCardBox(null)).toBeNull();
  });

  it("matches a new track once, then skips until a recheck is due", () => {
    const t = createLiveCardTracker({ votesBeforeLock: 1 });
    expect(t.decide({ box, hash: hashA, nowMs: 0 })).toEqual({ action: "match", reason: "new_track" });
    t.noteMatch({ hash: hashA, tcgdexId: "sv1-1", nowMs: 0 });
    expect(t.current()?.matched).toBe(true);
    expect(t.current()?.locked).toBe(true);
    expect(t.decide({ box: moved, hash: hashA, nowMs: 300 })).toEqual({
      action: "skip",
      reason: "already_matched",
      tcgdexId: "sv1-1",
    });
    // Near-hash (1 bit) stays locked; a huge jump would recheck via hashJumpBits.
    const near = "0".repeat(104) + "1";
    expect(t.decide({ box: moved, hash: near, nowMs: 600 })).toEqual({
      action: "skip",
      reason: "already_matched",
      tcgdexId: "sv1-1",
    });
    // Keep the track alive (lostAfterMs 1500), then hit recheckAfterMs 2500.
    expect(t.decide({ box: moved, hash: hashA, nowMs: 2000 })).toEqual({
      action: "skip",
      reason: "already_matched",
      tcgdexId: "sv1-1",
    });
    expect(t.decide({ box: moved, hash: hashA, nowMs: 2600 })).toEqual({
      action: "match",
      reason: "recheck",
    });
  });

  it("skips the same crop hash even after the box jumps or the tracker resets", () => {
    const t = createLiveCardTracker({ votesBeforeLock: 1 });
    t.decide({ box, hash: hashA, nowMs: 0 });
    t.noteMatch({ hash: hashA, tcgdexId: "sv1-1", nowMs: 0 });
    expect(t.decide({ box: elsewhere, hash: hashA, nowMs: 300 })).toEqual({
      action: "skip",
      reason: "same_crop",
      tcgdexId: "sv1-1",
    });
    t.reset();
    expect(t.current()).toBeNull();
    expect(t.decide({ box, hash: hashA, nowMs: 900 })).toEqual({
      action: "skip",
      reason: "same_crop",
      tcgdexId: "sv1-1",
    });
  });

  it("does not rematch an unchanged rejected crop before recheck", () => {
    const t = createLiveCardTracker({ votesBeforeLock: 1 });
    t.decide({ box, hash: hashA, nowMs: 0 });
    t.noteMatch({ hash: hashA, tcgdexId: null, nowMs: 0 });
    expect(t.decide({ box, hash: hashA, nowMs: 300 })).toEqual({
      action: "skip",
      reason: "already_matched",
      tcgdexId: null,
    });
  });

  it("starts a new track when the box jumps to a new crop", () => {
    const t = createLiveCardTracker({ votesBeforeLock: 1 });
    t.decide({ box, hash: hashA, nowMs: 0 });
    t.noteMatch({ hash: hashA, tcgdexId: "sv1-1", nowMs: 0 });
    const first = t.current()?.id;
    expect(t.decide({ box: elsewhere, hash: hashB, nowMs: 300 })).toEqual({
      action: "match",
      reason: "new_track",
    });
    expect(t.current()?.id).not.toBe(first);
    expect(t.activeTracks().length).toBeGreaterThanOrEqual(1);
    t.reset();
    expect(t.current()).toBeNull();
  });

  it("keeps up to three concurrent tracks", () => {
    const t = createLiveCardTracker({ maxTracks: 3, lostAfterMs: 10_000 });
    const boxes = [
      { x: 0.0, y: 0.1, width: 0.2, height: 0.3 },
      { x: 0.35, y: 0.1, width: 0.2, height: 0.3 },
      { x: 0.7, y: 0.1, width: 0.2, height: 0.3 },
      { x: 0.1, y: 0.55, width: 0.2, height: 0.3 },
    ];
    for (const [i, b] of boxes.entries()) {
      const decision = t.decide({ box: b, hash: cardHash(i + 1), nowMs: i * 100 });
      expect(decision.action).toBe("match");
      t.noteMatch({ hash: cardHash(i + 1), tcgdexId: `sv1-${i + 1}`, nowMs: i * 100 });
    }
    expect(t.activeTracks().length).toBe(3);
  });

  it("falls back to the hash when the native build sends no box", () => {
    const t = createLiveCardTracker({ votesBeforeLock: 1 });
    expect(t.decide({ box: null, hash: hashA, nowMs: 0 }).reason).toBe("no_box");
    t.noteMatch({ hash: hashA, tcgdexId: "sv1-1", nowMs: 0 });
    expect(t.decide({ box: null, hash: hashA, nowMs: 300 })).toEqual({
      action: "skip",
      reason: "already_matched",
      tcgdexId: "sv1-1",
    });
    expect(t.decide({ box: null, hash: hashB, nowMs: 600 }).reason).toBe("no_box");
  });

  it("replays a recorded stream at ≥90% with one model call per card before recheck", () => {
    const cards = ["base1-4", "base1-58", "swsh3-136", "sv1-1", "sv2-25"];
    const frames: LiveStreamReplayFrame[] = [];
    let now = 0;
    for (const [index, id] of cards.entries()) {
      const cardBox = {
        x: index % 2 === 0 ? 0.12 : 0.58,
        y: 0.18,
        width: 0.28,
        height: 0.42,
      };
      for (let f = 0; f < 8; f++) {
        frames.push({
          box: { ...cardBox, x: cardBox.x + f * 0.002 },
          hash: cardHash(index + 1, f),
          nowMs: now,
          expectedId: id,
        });
        now += 250;
      }
      frames.push({ box: null, hash: null, nowMs: now, expectedId: null });
      now += 250;
    }
    const replay = replayLiveCardStream(frames, (frame) => frame.expectedId);
    // Default votesBeforeLock=3: three identify calls gather the P1 vote, then lock.
    expect(replay.matchCalls).toBe(cards.length * 3);
    expect(replay.maxCallsPerTrack).toBe(3);
    expect(replay.matchRate).toBeGreaterThanOrEqual(0.9);
    expect(replay.identified).toBe(cards.length * 8);
  });

  it("gathers three identify calls before locking a new track", () => {
    const t = createLiveCardTracker();
    expect(t.decide({ box, hash: hashA, nowMs: 0 }).action).toBe("match");
    t.noteMatch({ hash: hashA, tcgdexId: "sv1-1", nowMs: 0 });
    expect(t.current()?.locked).toBe(false);
    // Slightly different crop hash so same_crop does not skip the vote frames.
    const hashA2 = "0".repeat(104) + "1";
    expect(t.decide({ box: moved, hash: hashA2, nowMs: 250 }).action).toBe("match");
    t.noteMatch({ hash: hashA2, tcgdexId: "sv1-1", nowMs: 250 });
    const hashA3 = "0".repeat(103) + "11";
    expect(t.decide({ box: moved, hash: hashA3, nowMs: 500 }).action).toBe("match");
    t.noteMatch({ hash: hashA3, tcgdexId: "sv1-1", nowMs: 500 });
    expect(t.current()?.locked).toBe(true);
    expect(t.decide({ box: moved, hash: hashA3, nowMs: 750 })).toEqual({
      action: "skip",
      reason: "already_matched",
      tcgdexId: "sv1-1",
    });
  });
});
