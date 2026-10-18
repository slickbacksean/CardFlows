import { describe, expect, it } from "vitest";
import { pregradeCopyViolations } from "./pregrade-copy";
import {
  calendarMonthKey,
  decideGradeConsume,
  extraCreditsLabel,
  GRADE_QUOTA_COPY,
  GRADE_QUOTA_FREE_PER_MONTH,
  GRADE_QUOTA_UNLIMITED_LIMIT,
  gradeQuotaSnapshot,
  monthlyLimitForPlan,
  nextMonthResetAt,
  remainingGradesCaption,
  remainingMonthlyLabel,
} from "./grade-quota";

describe("grade quota", () => {
  it("gives free accounts 10 quick estimates a month and premium unlimited (Sean, Oct 18)", () => {
    expect(monthlyLimitForPlan("free")).toBe(GRADE_QUOTA_FREE_PER_MONTH);
    expect(GRADE_QUOTA_FREE_PER_MONTH).toBe(10);
    expect(monthlyLimitForPlan("premium")).toBe(GRADE_QUOTA_UNLIMITED_LIMIT);
    const now = new Date("2026-10-18T00:00:00.000Z");
    const premium = gradeQuotaSnapshot({ plan: "premium", usedThisMonth: 500, extraCredits: 0, iapEnabled: false, now });
    expect(premium.unlimited).toBe(true);
    expect(premium.remainingGrades).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(premium)).monthlyLimit).toBe(GRADE_QUOTA_UNLIMITED_LIMIT);
    expect(remainingGradesCaption(premium)).toBe("Unlimited quick pre-grade estimates");
    expect(decideGradeConsume({ usedThisMonth: 10_000, monthlyLimit: premium.monthlyLimit, extraCredits: 3 })).toEqual({ ok: true, source: "monthly" });
    const free = gradeQuotaSnapshot({ plan: "free", usedThisMonth: 0, extraCredits: 0, iapEnabled: false, now });
    expect(free.unlimited).toBeUndefined();
    expect(remainingGradesCaption(free)).toBe("10 pre-grade estimates left this month. Resets Nov 1.");
  });

  it("keys the month in UTC and resets at the next UTC month", () => {
    const lateOctober = new Date("2026-10-31T23:00:00.000Z");
    expect(calendarMonthKey(lateOctober)).toBe("2026-10");
    expect(nextMonthResetAt(lateOctober).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(calendarMonthKey(new Date("2026-11-01T00:00:00.000Z"))).toBe("2026-11");
    expect(nextMonthResetAt(new Date("2026-12-15T12:00:00.000Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("spends the monthly allowance before extra credits", () => {
    expect(
      decideGradeConsume({ usedThisMonth: 4, monthlyLimit: 5, extraCredits: 0 }),
    ).toEqual({ ok: true, source: "monthly" });
    expect(
      decideGradeConsume({ usedThisMonth: 5, monthlyLimit: 5, extraCredits: 2 }),
    ).toEqual({ ok: true, source: "credit" });
    expect(decideGradeConsume({ usedThisMonth: 5, monthlyLimit: 5, extraCredits: 0 })).toEqual({
      ok: false,
    });
  });

  it("counts remaining as unused monthly plus credits", () => {
    const snap = gradeQuotaSnapshot({
      plan: "free",
      usedThisMonth: 3,
      extraCredits: 2,
      iapEnabled: false,
      now: new Date("2026-10-13T17:00:00.000Z"),
    });
    expect(snap).toMatchObject({
      month: "2026-10",
      monthlyLimit: 10,
      remainingMonthly: 7,
      extraCredits: 2,
      remainingGrades: 9,
      iapEnabled: false,
    });
    expect(snap.resetsAt).toBe("2026-11-01T00:00:00.000Z");
  });

  it("uses Pre-grade estimate wording with no AI or company names", () => {
    const strings = [
      ...Object.values(GRADE_QUOTA_COPY),
      remainingMonthlyLabel(0),
      remainingMonthlyLabel(1),
      remainingMonthlyLabel(5),
      extraCreditsLabel(0),
      extraCreditsLabel(1),
      extraCreditsLabel(3),
      remainingGradesCaption({ remainingMonthly: 0, extraCredits: 0, remainingGrades: 0 }),
      remainingGradesCaption({ remainingMonthly: 2, extraCredits: 1, remainingGrades: 3 }),
    ];
    for (const text of strings) expect(pregradeCopyViolations(text), text).toEqual([]);
    expect(remainingGradesCaption({ remainingMonthly: 0, extraCredits: 0, remainingGrades: 0 })).toBe(
      GRADE_QUOTA_COPY.outOfGrades,
    );
    expect(GRADE_QUOTA_COPY.outOfGrades).toContain("pre-grade estimate");
    expect(GRADE_QUOTA_COPY.getExtra).not.toMatch(/\bAI\b|\bPSA\b|\bBGS\b|\bCGC\b/i);
  });
});
