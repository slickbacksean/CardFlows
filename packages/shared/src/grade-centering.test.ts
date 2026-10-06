import { describe, expect, it } from "vitest";
import {
  centeringScoreFromShare,
  formatCenteringRatio,
  measuredCenteringSubgrade,
  parseCenteringRatio,
  parseMeasuredCenteringRatios,
} from "./grade-centering";

describe("measured centering (PSA-style table)", () => {
  it("maps larger-share to estimate scores without inventing unmeasured values", () => {
    expect(centeringScoreFromShare(50)).toBe(10);
    expect(centeringScoreFromShare(55)).toBe(10);
    expect(centeringScoreFromShare(60)).toBe(9);
    expect(centeringScoreFromShare(65)).toBe(8);
    expect(centeringScoreFromShare(70)).toBe(7);
    expect(centeringScoreFromShare(96)).toBe(1);
    expect(centeringScoreFromShare(null)).toBeNull();
    expect(measuredCenteringSubgrade({}).score).toBeNull();
  });

  it("uses the worse of L/R and T/B and formats ratios", () => {
    expect(formatCenteringRatio(58, 42)).toBe("58/42");
    expect(parseCenteringRatio("55/45")).toEqual({ left: 55, right: 45 });
    const measured = measuredCenteringSubgrade({
      lr: { left: 55, right: 45 },
      tb: { left: 70, right: 30 },
    });
    expect(measured.measured).toBe(true);
    expect(measured.score).toBe(7);
    expect(measured.ratio).toBe("55/45 · 70/30");
    expect(parseMeasuredCenteringRatios("55/45 · 70/30")).toEqual({
      lr: { left: 55, right: 45 },
      tb: { left: 70, right: 30 },
    });
  });
});
