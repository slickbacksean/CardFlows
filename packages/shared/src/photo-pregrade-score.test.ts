import { describe, expect, it } from "vitest";
import { isScoredEstimate } from "./photo-pregrade";

describe("isScoredEstimate", () => {
  it("accepts only finite grades from 1.0 to 10.0", () => {
    expect(isScoredEstimate(1)).toBe(true);
    expect(isScoredEstimate(8.37)).toBe(true);
    expect(isScoredEstimate(10)).toBe(true);
  });

  it("rejects 0 and other non-grades (retake, never a missing/unavailable score)", () => {
    expect(isScoredEstimate(0)).toBe(false);
    expect(isScoredEstimate(0.0)).toBe(false);
    expect(isScoredEstimate(-1)).toBe(false);
    expect(isScoredEstimate(10.01)).toBe(false);
    expect(isScoredEstimate(Number.NaN)).toBe(false);
    expect(isScoredEstimate(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
