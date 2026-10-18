import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BATCH_QUEUE_NOTE, batchCandidates, batchSummary, runBatchQueue } from "./batch-grade-queue";
import { emptyGradeEstimate, unavailableGradeEstimate, type CardFlowGradeEstimate } from "./grade-estimate";

const est = (overall: number) => ({ ...emptyGradeEstimate(), overall, display: String(overall) });

describe("batch grade queue", () => {
  it("keeps purchased cards with a stored front, session-scoped", () => {
    const items = [
      { inventoryItemId: "a", intent: "purchased", createdAt: "2026-10-14T10:00:00Z", gradePhotos: { front: true, back: false } },
      { inventoryItemId: "b", intent: "watchlist", createdAt: "2026-10-14T11:00:00Z", imageStorageRef: "x" },
      { inventoryItemId: "c", intent: "purchased", createdAt: "2026-10-14T12:00:00Z", imageStorageRef: "x" },
      { inventoryItemId: "d", intent: "purchased", createdAt: "2026-10-14T12:00:00Z" },
    ];
    expect(batchCandidates(items).map((i) => i.inventoryItemId)).toEqual(["a", "c"]);
    expect(batchCandidates(items, "2026-10-14T11:30:00Z").map((i) => i.inventoryItemId)).toEqual(["c"]);
  });
  it("runs sequentially and stops after repeated unavailable", async () => {
    const results: Record<string, CardFlowGradeEstimate> = { a: est(8), b: unavailableGradeEstimate(), c: unavailableGradeEstimate(), d: est(9) };
    let running = 0;
    let maxRunning = 0;
    const out = await runBatchQueue(["a", "b", "c", "d"], async (id) => {
      running += 1; maxRunning = Math.max(maxRunning, running);
      await Promise.resolve();
      running -= 1;
      return results[id]!;
    }, () => {});
    expect(maxRunning).toBe(1);
    expect(out.map((i) => i.status)).toEqual(["done", "unavailable", "unavailable", "skipped"]);
    expect(batchSummary(out)).toBe("1 of 4 estimated · 2 unavailable · 1 skipped");
  });
  it("marks empty estimates as retake and honors cancel", async () => {
    const out = await runBatchQueue(["a", "b"], async () => emptyGradeEstimate(), () => {}, (() => { let n = 0; return () => n++ > 0; })());
    expect(out.map((i) => i.status)).toEqual(["no_estimate", "skipped"]);
  });
  it("copy and screen stay pre-grade only", () => {
    expect(BATCH_QUEUE_NOTE).toContain("Estimate only. Not an official grade.");
    const screen = readFileSync(resolve(__dirname, "../../../apps/mobile/app/grade-batch.tsx"), "utf8");
    expect(screen).toContain("runBatchQueue");
    expect(screen).not.toMatch(/\bAI\b|PSA|BGS|CGC/);
  });
});
