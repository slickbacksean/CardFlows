import { describe, expect, it } from "vitest";
import { INITIAL_CAPTURE_STATE, frameHint, nextCaptureState, type CaptureFrame } from "./auto-capture";
import type { CardQuad } from "./card-quad";

function quad(corners: CardQuad["corners"], over: Partial<CardQuad> = {}): CardQuad {
  return {
    version: 1,
    source: "card-finder",
    sourceVersion: "test",
    imageWidth: 1000,
    imageHeight: 1300,
    corners,
    confidence: 0.95,
    accepted: true,
    outOfPlaneDeg: 2,
    rejectReasons: [],
    ...over,
  };
}

const square = quad([
  [150, 150],
  [850, 150],
  [850, 1128],
  [150, 1128],
]);

const frame = (t: number, q: CardQuad | null = square): CaptureFrame => ({ timestampMs: t, quad: q, sharpness: 200, glare: 0 });

describe("auto-capture", () => {
  it("fires after half a second of steady ready frames", () => {
    let s = INITIAL_CAPTURE_STATE;
    for (const t of [0, 100, 200, 300, 400]) {
      s = nextCaptureState(s, frame(t));
      expect(s.fire).toBe(false);
    }
    s = nextCaptureState(s, frame(500));
    expect(s.hint).toBe("ready");
    expect(s.fire).toBe(true);
  });

  it("asks to hold square when the far edge is shorter", () => {
    const keystone = quad([
      [200, 150],
      [800, 150],
      [850, 1128],
      [150, 1128],
    ]);
    expect(frameHint(frame(0, keystone))).toBe("hold_square");
  });

  it("resets the timer when the card moves", () => {
    let s = nextCaptureState(INITIAL_CAPTURE_STATE, frame(0));
    const moved = quad(square.corners.map(([x, y]) => [x + 30, y] as const) as unknown as CardQuad["corners"]);
    s = nextCaptureState(s, frame(300, moved));
    expect(s.hint).toBe("hold_still");
    s = nextCaptureState(s, frame(600, moved));
    expect(s.fire).toBe(false);
  });

  it("never fires on a cut-off or unconfident card", () => {
    expect(frameHint(frame(0, quad(square.corners, { confidence: 0.4 })))).toBe("find_card");
    const cut = quad([
      [0, 150],
      [850, 150],
      [850, 1128],
      [0, 1128],
    ]);
    expect(frameHint(frame(0, cut))).toBe("fit_whole_card");
  });
});
