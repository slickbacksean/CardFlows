import { describe, expect, it } from "vitest";
import { addMonthsClamped, quotaAnchor, quotaPeriodFor, resetDateLabel } from "./quota-period";

describe("allowance resets on the account's own date", () => {
  it("resets on the anchor day each month", () => {
    const p = quotaPeriodFor("2026-03-15T10:00:00.000Z", new Date("2026-10-20T00:00:00Z"));
    expect(p).toEqual({ key: "2026-10-15", startsAt: "2026-10-15T10:00:00.000Z", resetsAt: "2026-11-15T10:00:00.000Z" });
    const before = quotaPeriodFor("2026-03-15T10:00:00.000Z", new Date("2026-10-15T09:59:59Z"));
    expect(before.key).toBe("2026-09-15");
    expect(before.resetsAt).toBe("2026-10-15T10:00:00.000Z");
  });
  it("clamps the 31st to short months", () => {
    expect(addMonthsClamped(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(quotaPeriodFor("2026-01-31T00:00:00Z", new Date("2026-03-01T00:00:00Z")).key).toBe("2026-02-28");
    expect(quotaPeriodFor("2026-01-31T00:00:00Z", new Date("2026-03-31T00:00:00Z")).key).toBe("2026-03-31");
  });
  it("billing date wins over creation date", () => {
    expect(quotaAnchor({ billingAnchorAt: "2026-05-02T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" })).toBe("2026-05-02T00:00:00Z");
    expect(quotaAnchor({ billingAnchorAt: null, createdAt: "2026-01-01T00:00:00Z" })).toBe("2026-01-01T00:00:00Z");
  });
  it("labels the reset date", () => {
    expect(resetDateLabel("2026-11-15T10:00:00.000Z")).toBe("Resets Nov 15");
  });
});

import { remainingGradesCaption } from "./grade-quota";
describe("reset date in the app caption", () => {
  it("ends the caption with the user's reset date", () => {
    expect(remainingGradesCaption({ remainingMonthly: 3, extraCredits: 0, remainingGrades: 3, resetsAt: "2026-11-15T10:00:00.000Z" })).toBe(
      "3 pre-grade estimates left this month. Resets Nov 15.",
    );
    expect(remainingGradesCaption({ remainingMonthly: 0, extraCredits: 0, remainingGrades: 0, resetsAt: "2026-11-15T10:00:00.000Z" })).toBe(
      "You're out of pre-grade estimates this month. Resets Nov 15.",
    );
  });
});
