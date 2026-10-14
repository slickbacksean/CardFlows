import { describe, expect, it } from "vitest";
import { createLiveScanTimingLog, percentile, summarizeLiveScanSamples } from "./live-scan-timing";

describe("live scan timing", () => {
  it("computes percentiles", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
  });

  it("summarizes stages and the accept rate", () => {
    const summary = summarizeLiveScanSamples([
      { stages: { embed: 40, total: 600 }, outcome: "accepted", warped: true },
      { stages: { embed: 50, total: 700 }, outcome: "rejected" },
      { stages: { detect: 12 }, outcome: "skipped" },
      { stages: { total: Number.NaN }, outcome: "error" },
    ]);
    expect(summary.samples).toBe(4);
    expect(summary.outcomes).toEqual({ accepted: 1, rejected: 1, skipped: 1, error: 1 });
    expect(summary.acceptRate).toBe(0.5);
    expect(summary.warpedRate).toBe(0.5);
    expect(summary.stages.embed).toEqual({ count: 2, p50: 50, p95: 50, max: 50 });
    expect(Object.keys(summary.stages)).toEqual(
      expect.arrayContaining(["embed", "total", "detect"]),
    );
    expect(summary.stages.total?.count).toBe(2);
    expect(summary.stages.detect?.count).toBe(1);
  });

  it("caps the ring buffer", () => {
    const log = createLiveScanTimingLog(3);
    for (let i = 0; i < 5; i++) log.add({ stages: { total: i }, outcome: "accepted" });
    expect(log.samples()).toHaveLength(3);
    expect(log.summary().stages.total?.p50).toBe(3);
    log.clear();
    expect(log.summary().samples).toBe(0);
  });
});
