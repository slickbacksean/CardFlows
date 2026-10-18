import { describe, expect, it } from "vitest";
import { CARD_QUAD_ASPECT, isCardQuad, scaleCardCorners, type CardQuad } from "./card-quad";

const quad: CardQuad = {
  version: 1,
  source: "card-finder",
  sourceVersion: "card-finder@0.1.0",
  imageWidth: 3024,
  imageHeight: 4032,
  corners: [
    [600, 800],
    [2400, 800],
    [2400, 3314],
    [600, 3314],
  ],
  confidence: 0.97,
  accepted: true,
  outOfPlaneDeg: 3.1,
  rejectReasons: [],
};

describe("card quad contract", () => {
  it("accepts a well-formed quad and rejects a 3-corner one", () => {
    expect(isCardQuad(quad)).toBe(true);
    expect(isCardQuad({ ...quad, corners: quad.corners.slice(0, 3) })).toBe(false);
  });

  it("scales preview corners to the full-res still", () => {
    const scaled = scaleCardCorners(quad.corners, { width: 3024, height: 4032 }, { width: 756, height: 1008 });
    expect(scaled[2]).toEqual([600, 828.5]);
  });

  it("uses the 63:88 card", () => {
    expect(CARD_QUAD_ASPECT).toBeCloseTo(0.716, 3);
  });
});
