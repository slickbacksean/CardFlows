import { describe, expect, it } from "vitest";
import { SCAN_QUOTA_FREE_PER_MONTH, remainingScansCaption, scanQuotaSnapshot } from "./scan-quota";

describe("scan quota (30 free / unlimited premium)", () => {
  const now = new Date("2026-10-18T12:00:00.000Z");

  it("gives free accounts 30 confirmed cards a month", () => {
    expect(SCAN_QUOTA_FREE_PER_MONTH).toBe(30);
    const snap = scanQuotaSnapshot({ plan: "free", usedThisMonth: 5, now });
    expect(snap.remainingScans).toBe(25);
    expect(snap.unlimited).toBeUndefined();
    expect(remainingScansCaption(snap)).toMatch(/25 card scans left/i);
  });

  it("is unlimited on Premium", () => {
    const snap = scanQuotaSnapshot({ plan: "premium", usedThisMonth: 500, now });
    expect(snap.unlimited).toBe(true);
    expect(remainingScansCaption(snap)).toMatch(/Unlimited/i);
  });

  it("reports out of scans at the free cap", () => {
    const snap = scanQuotaSnapshot({ plan: "free", usedThisMonth: 30, now });
    expect(snap.remainingScans).toBe(0);
    expect(remainingScansCaption(snap)).toMatch(/out of free card scans/i);
  });
});
