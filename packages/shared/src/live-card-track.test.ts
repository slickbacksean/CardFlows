import { describe, expect, it } from "vitest";
import { bitHashDistance, boxIou, createLiveCardTracker, normalizeLiveCardBox } from "./live-card-track";

const box = { x: 0.3, y: 0.2, width: 0.3, height: 0.42 };
const moved = { x: 0.31, y: 0.21, width: 0.3, height: 0.42 };
const elsewhere = { x: 0.0, y: 0.0, width: 0.2, height: 0.28 };
const hashA = "0".repeat(105);
const hashB = "1".repeat(105);

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

  it("matches a new track until stable, then skips until reconfirm", () => {
    const t = createLiveCardTracker({ reconfirmMs: 2500 });
    expect(t.decide({ box, hash: hashA, nowMs: 0 })).toEqual({ action: "match", reason: "new_track" });
    t.noteMatch({ hash: hashA, tcgdexId: "sv1-1", nowMs: 0 });
    // One hit is pending: confirm it even though the crop is unchanged.
    expect(t.decide({ box: moved, hash: hashA, nowMs: 300 }).action).toBe("match");
    t.noteMatch({ hash: hashA, tcgdexId: "sv1-1", nowMs: 300 });
    expect(t.current()?.stable).toBe(true);
    expect(t.decide({ box: moved, hash: hashB, nowMs: 600 })).toEqual({
      action: "skip",
      reason: "stable_track",
    });
    expect(t.decide({ box: moved, hash: hashA, nowMs: 2900 })).toEqual({
      action: "match",
      reason: "reconfirm",
    });
  });

  it("skips an unchanged rejected crop but re-matches when it changes", () => {
    const t = createLiveCardTracker();
    t.decide({ box, hash: hashA, nowMs: 0 });
    t.noteMatch({ hash: hashA, tcgdexId: null, nowMs: 0 });
    expect(t.decide({ box, hash: hashA, nowMs: 300 })).toEqual({
      action: "skip",
      reason: "unchanged_crop",
    });
    expect(t.decide({ box, hash: hashB, nowMs: 600 })).toEqual({ action: "match", reason: "unstable" });
  });

  it("starts a new track when the box jumps or after reset", () => {
    const t = createLiveCardTracker();
    t.decide({ box, hash: hashA, nowMs: 0 });
    t.noteMatch({ hash: hashA, tcgdexId: "sv1-1", nowMs: 0 });
    t.noteMatch({ hash: hashA, tcgdexId: "sv1-1", nowMs: 10 });
    const first = t.current()?.id;
    expect(t.decide({ box: elsewhere, hash: hashA, nowMs: 300 }).reason).toBe("new_track");
    expect(t.current()?.id).not.toBe(first);
    t.reset();
    expect(t.current()).toBeNull();
  });

  it("falls back to the hash when the native build sends no box", () => {
    const t = createLiveCardTracker();
    expect(t.decide({ box: null, hash: hashA, nowMs: 0 }).reason).toBe("no_box");
    t.noteMatch({ hash: hashA, tcgdexId: null, nowMs: 0 });
    expect(t.decide({ box: null, hash: hashA, nowMs: 300 }).reason).toBe("unchanged_crop");
    expect(t.decide({ box: null, hash: hashB, nowMs: 600 }).reason).toBe("no_box");
  });
});
