import { describe, expect, it } from "vitest";
import {
  GRADE_EXTRA_SHOTS,
  GRADE_FULL_COPY,
  GRADE_FULL_SHOTS,
  GRADE_FULL_SHOTS_PER_SIDE,
  gradeFullAllowance,
  gradeFullModeEnabled,
  gradeFullMonthlyLimit,
  gradeFullRemainingCaption,
  gradeFullUsageKey,
  gradeFullProgressLabel,
  gradeTiltShotHint,
  isGradeExtraShot,
} from "./grade-full-mode";
import { PREMIUM_FEATURES } from "./premium";

describe("full 14-photo pre-grade plan (Sean, Oct 18)", () => {
  it("is 7 shots per side: flat, 2 tilted, 4 corners (TL, TR, BR, BL)", () => {
    expect(GRADE_FULL_SHOTS_PER_SIDE * 2).toBe(14);
    expect(GRADE_FULL_SHOTS).toEqual(["flat", "tilt_a", "tilt_b", "corner_tl", "corner_tr", "corner_br", "corner_bl"]);
    expect(GRADE_EXTRA_SHOTS).not.toContain("flat");
    expect(isGradeExtraShot("corner_br")).toBe(true);
    expect(isGradeExtraShot("flat")).toBe(false);
    for (const shot of GRADE_FULL_SHOTS) expect(GRADE_FULL_COPY.prompts[shot].length).toBeGreaterThan(10);
  });

  it("labels progress per side", () => {
    expect(gradeFullProgressLabel("front", 0)).toBe("Front 1/7");
    expect(gradeFullProgressLabel("front", 2)).toBe("Front 3/7");
    expect(gradeFullProgressLabel("back", 6)).toBe("Back 7/7");
    expect(gradeFullProgressLabel("back", 99)).toBe("Back 7/7");
  });

  it("auto-captures a tilted shot only inside 15-25 degrees", () => {
    expect(gradeTiltShotHint(null)).toBe(GRADE_FULL_COPY.tiltMore);
    expect(gradeTiltShotHint(8)).toBe(GRADE_FULL_COPY.tiltMore);
    expect(gradeTiltShotHint(20)).toBeNull();
    expect(gradeTiltShotHint(31)).toBe(GRADE_FULL_COPY.tiltLess);
  });

  it("is a monthly allowance (free 2, Premium 25), not Premium-locked, behind the flag", () => {
    expect(gradeFullMonthlyLimit("free")).toBe(2);
    expect(gradeFullMonthlyLimit("premium")).toBe(25);
    expect(gradeFullAllowance("free", 1)).toEqual({ monthlyLimit: 2, usedThisMonth: 1, remaining: 1 });
    expect(gradeFullAllowance("free", 5).remaining).toBe(0);
    expect(gradeFullRemainingCaption(gradeFullAllowance("free", 1))).toBe("1 full grade left this month");
    expect(gradeFullRemainingCaption(gradeFullAllowance("premium", 0))).toBe("25 full grades left this month");
    expect(gradeFullUsageKey("2026-10-03")).toBe("2026-10-03#full");
    expect(gradeFullModeEnabled("on")).toBe(true);
    expect(gradeFullModeEnabled(" ON ")).toBe(true);
    expect(gradeFullModeEnabled(undefined)).toBe(false);
    expect(gradeFullModeEnabled("1")).toBe(false);
    expect(PREMIUM_FEATURES).not.toContain("full_grade");
  });

  it("keeps the copy rules: estimate only, no AI, no official grade", () => {
    const all = JSON.stringify(GRADE_FULL_COPY);
    expect(all).toContain("Estimate only. Not an official grade.");
    expect(all).not.toMatch(/\bAI\b/);
  });
});
