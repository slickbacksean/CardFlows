import { describe, expect, it } from "vitest";
import { confirmEventFor } from "./confirm-log";
import { computeMappingMetrics, mappingMetricsMarkdown, setIdOfTcgdexId, weeklyWindow } from "./mapping-metrics";

const at = (d: number) => new Date(Date.UTC(2026, 9, d));
const ev = (shown: string[], chosen: string, d: number, via?: string) =>
  confirmEventFor({ scanId: `s${d}${chosen}`, userId: "u1", via, shownTcgdexIds: shown, chosenTcgdexId: chosen, now: at(d) });

describe("mapping metrics", () => {
  it("parses set ids", () => {
    expect(setIdOfTcgdexId("base1-58")).toBe("base1");
    expect(setIdOfTcgdexId("sv03.5-025")).toBe("sv03.5");
  });

  it("computes the weekly report", () => {
    const events = [
      ev(["base1-58"], "base1-58", 8),
      ev(["base4-51", "base1-36"], "base1-36", 9),
      ev(["base1-4"], "base2-4", 10, "manual_search"),
      ev(["base1-1"], "base1-1", 1), // outside the window
    ];
    const r = computeMappingMetrics({
      events,
      ...weeklyWindow(at(14)),
      unmappedSetNames: [{ setName: "Base Set 2", source: "pokecollector", count: 3, catalogSetId: null } as never],
    });
    expect(r.confirms).toBe(3);
    expect(r.top1Rate).toBeCloseTo(0.333, 3);
    expect(r.manualSearchRate).toBeCloseTo(0.333, 3);
    expect(r.correctionRate).toBeCloseTo(0.667, 3);
    expect(r.setMismatches).toEqual([
      { predictedSetId: "base4", chosenSetId: "base1", count: 1 },
      { predictedSetId: "base1", chosenSetId: "base2", count: 1 },
    ]);
    expect(r.perSet.find((s) => s.setId === "base1")).toMatchObject({ confirms: 2, corrections: 1 });
    const md = mappingMetricsMarkdown(r);
    expect(md).toContain("Base Set 2 (pokecollector) × 3");
    expect(md).not.toContain("u1");
    expect(JSON.stringify(r)).not.toContain("u1");
  });

  it("handles an empty week", () => {
    const r = computeMappingMetrics({ events: [], ...weeklyWindow(at(14)) });
    expect(r).toMatchObject({ confirms: 0, top1Rate: 0, perSet: [] });
    expect(mappingMetricsMarkdown(r)).toContain("- None");
  });
});
