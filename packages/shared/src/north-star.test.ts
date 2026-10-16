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
      { weekStart: "2026-10-05", purchased: 1, activeResellers: 1, perActiveReseller: 1 },
      { weekStart: "2026-10-12", purchased: 3, activeResellers: 3, perActiveReseller: 1 },
    ]);
    expect(northStarWeekly([], { weeks: 1, now: new Date("2026-10-15T00:00:00Z") })[0]?.perActiveReseller).toBeNull();
  });
});
