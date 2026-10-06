import { describe, expect, it } from "vitest";
import { wearScoresFromDefectCounts } from "./grade-wear";

describe("wear scores from defect counts", () => {
  it("stays 10 with no defects", () => {
    expect(wearScoresFromDefectCounts({ corners: 0, edges: 0, surface: 0 })).toEqual({
      corners: 10,
      edges: 10,
      surface: 10,
    });
  });

  it("caps conservatively and never raises a score", () => {
    expect(wearScoresFromDefectCounts({ corners: 1, edges: 0, surface: 1 }).corners).toBe(9);
    expect(wearScoresFromDefectCounts({ corners: 2, edges: 2, surface: 2 })).toEqual({
      corners: 7.5,
      edges: 7.5,
      surface: 8,
    });
    expect(wearScoresFromDefectCounts({ corners: 0, edges: 0, surface: 0, creases: 1 })).toEqual({
      corners: 7,
      edges: 7,
      surface: 7,
    });
  });
});
