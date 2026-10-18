import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { appendGradeHistory, GRADE_HISTORY_MAX, GRADE_HISTORY_NOTE, GRADE_HISTORY_TITLE, gradeHistoryLines, parseGradeHistory } from "./grade-history";

describe("grade history", () => {
  it("skips empty or retake estimates and caps length", () => {
    expect(appendGradeHistory([], { overall: null, confidence: null }, "2026-10-14T00:00:00Z")).toEqual([]);
    expect(appendGradeHistory([], { overall: 0, confidence: null }, "2026-10-14T00:00:00Z")).toEqual([]);
    let h = [] as ReturnType<typeof appendGradeHistory>;
    for (let i = 0; i < 12; i += 1) h = appendGradeHistory(h, { overall: 5 + i * 0.1, confidence: "medium" }, new Date(Date.UTC(2026, 9, 1 + i)).toISOString());
    expect(h).toHaveLength(GRADE_HISTORY_MAX);
  });
  it("dedupes an identical repeat within a minute", () => {
    const h = appendGradeHistory([], { overall: 8, confidence: null }, "2026-10-14T00:00:00Z");
    expect(appendGradeHistory(h, { overall: 8, confidence: null }, "2026-10-14T00:00:30Z")).toHaveLength(1);
  });
  it("lines are newest first with change", () => {
    let h = appendGradeHistory([], { overall: 8, confidence: null }, "2026-10-10T12:00:00Z");
    h = appendGradeHistory(h, { overall: 8.5, confidence: null }, "2026-10-14T12:00:00Z");
    expect(gradeHistoryLines(h)).toEqual(["Oct 14 · 8.5 · up 0.5", "Oct 10 · 8 · first"]);
    expect(parseGradeHistory(JSON.stringify(h))).toEqual(h);
    expect(parseGradeHistory("nope")).toEqual([]);
  });
  it("copy is pre-grade only", () => {
    for (const text of [GRADE_HISTORY_TITLE, GRADE_HISTORY_NOTE]) expect(text).not.toMatch(/\bAI\b|PSA|BGS|CGC/);
    expect(GRADE_HISTORY_NOTE).toBe("Estimate only. Not an official grade.");
    const sheet = readFileSync(resolve(__dirname, "../../../apps/mobile/components/ui/prepare-sheet.tsx"), "utf8");
    expect(sheet).toContain("recordGradeHistory");
    expect(sheet).toContain("GRADE_HISTORY_TITLE");
  });
});

describe("grade history sync", () => {
  it("phone reads server history and uploads local entries once via the offline queue", () => {
    const lib = readFileSync(resolve(__dirname, "../../../apps/mobile/lib/grade-history.ts"), "utf8");
    expect(lib).toContain("getGradeHistory");
    expect(lib).toContain('runQueueableWrite("import_grade_history"');
    expect(lib).toContain("clearLegacy");
  });
});
