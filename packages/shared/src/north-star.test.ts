import { describe, expect, it } from "vitest";
import { isoWeekStart, northStarWeekly } from "./north-star";

describe("D10 North Star", () => {
  it("weeks start Monday UTC", () => {
    expect(isoWeekStart(new Date("2026-10-15T23:00:00Z")).toISOString().slice(0, 10)).toBe("2026-10-12");
    expect(isoWeekStart(new Date("2026-10-18T10:00:00Z")).toISOString().slice(0, 10)).toBe("2026-10-12");
    expect(isoWeekStart(new Date("2026-10-19T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-10-19");
  });
  it("purchased per weekly active reseller, scan-only users count as active", () => {
    const weeks = northStarWeekly(
      [
        { userId: "a", scans: ["2026-10-13T10:00:00Z"], purchases: ["2026-10-13T10:01:00Z", "2026-10-14T09:00:00Z", "2026-10-06T09:00:00Z"] },
        { userId: "b", scans: ["2026-10-15T10:00:00Z"], purchases: [] },
        { userId: "c", scans: [], purchases: ["2026-10-15T12:00:00Z"] },
      ],
      { weeks: 2, now: new Date("2026-10-15T20:00:00Z") },
    );
    expect(weeks).toEqual([
      { weekStart: "2026-10-05", purchased: 1, activeResellers: 1, perActiveReseller: 1, scans: 0, scansPerActiveReseller: 0 },
      { weekStart: "2026-10-12", purchased: 3, activeResellers: 3, perActiveReseller: 1, scans: 2, scansPerActiveReseller: 0.67 },
    ]);
    expect(northStarWeekly([], { weeks: 1, now: new Date("2026-10-15T00:00:00Z") })[0]?.perActiveReseller).toBeNull();
  });
});

describe("H2: deleted accounts' weekly totals", () => {
  it("rolls one user into per-week counts and adds them back without double counting", async () => {
    const { northStarUserWeekTotals, northStarWeekly } = await import("./north-star");
    const now = new Date("2026-10-14T12:00:00Z");
    const gone = { userId: "gone", scans: ["2026-10-13T00:00:00Z", "2026-10-06T00:00:00Z"], purchases: ["2026-10-13T01:00:00Z", "bad"] };
    const live = { userId: "live", scans: ["2026-10-13T02:00:00Z"], purchases: [] };
    const totals = northStarUserWeekTotals(gone);
    expect(totals).toEqual([
      { weekStart: "2026-10-05", purchased: 0, scans: 1, activeResellers: 1 },
      { weekStart: "2026-10-12", purchased: 1, scans: 1, activeResellers: 1 },
    ]);
    expect(northStarWeekly([live], { now, weeks: 2, totals })).toEqual(northStarWeekly([gone, live], { now, weeks: 2 }));
    expect(northStarUserWeekTotals({ scans: [], purchases: [] })).toEqual([]);
  });
});
