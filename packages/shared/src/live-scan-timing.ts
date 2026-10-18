/**
 * Per-stage livestream scanner timings (debug only). Pure helpers shared by the
 * API and the phone so both report the same p50/p95 shape.
 */

export const LIVE_SCAN_STAGES = [
  "detect",
  "pull",
  "upload",
  "serverDecode",
  "warp",
  "embed",
  "search",
  "orb",
  "phash",
  "sidecar",
  "server",
  "total",
] as const;

export type LiveScanStage = (typeof LIVE_SCAN_STAGES)[number];

export type LiveScanOutcome = "accepted" | "rejected" | "skipped" | "error";

export interface LiveScanSample {
  stages: Partial<Record<LiveScanStage, number>>;
  outcome: LiveScanOutcome;
  /** The server straightened the crop from 4 corners before matching. */
  warped?: boolean;
}

export interface LiveScanStageSummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export interface LiveScanSummary {
  samples: number;
  outcomes: Record<LiveScanOutcome, number>;
  /** accepted / (accepted + rejected); skipped and error frames excluded. */
  acceptRate: number | null;
  warpedRate: number | null;
  stages: Partial<Record<LiveScanStage, LiveScanStageSummary>>;
}

export function percentile(sorted: readonly number[], pct: number): number {
  if (!sorted.length) return 0;
  const index = Math.round((pct / 100) * (sorted.length - 1));
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))]!;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function summarizeLiveScanSamples(samples: readonly LiveScanSample[]): LiveScanSummary {
  const outcomes: Record<LiveScanOutcome, number> = {
    accepted: 0,
    rejected: 0,
    skipped: 0,
    error: 0,
  };
  const byStage = new Map<LiveScanStage, number[]>();
  let matched = 0;
  let warped = 0;
  for (const sample of samples) {
    outcomes[sample.outcome] += 1;
    if (sample.outcome === "accepted" || sample.outcome === "rejected") {
      matched += 1;
      if (sample.warped) warped += 1;
    }
    for (const stage of LIVE_SCAN_STAGES) {
      const value = sample.stages[stage];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
      const list = byStage.get(stage) ?? [];
      list.push(value);
      byStage.set(stage, list);
    }
  }
  const stages: Partial<Record<LiveScanStage, LiveScanStageSummary>> = {};
  for (const stage of LIVE_SCAN_STAGES) {
    const list = byStage.get(stage);
    if (!list?.length) continue;
    const sorted = [...list].sort((a, b) => a - b);
    stages[stage] = {
      count: sorted.length,
      p50: round(percentile(sorted, 50)),
      p95: round(percentile(sorted, 95)),
      max: round(sorted[sorted.length - 1]!),
    };
  }
  return {
    samples: samples.length,
    outcomes,
    acceptRate: matched ? round((outcomes.accepted / matched) * 1000) / 1000 : null,
    warpedRate: matched ? round((warped / matched) * 1000) / 1000 : null,
    stages,
  };
}

/** Fixed-size ring buffer so debug timing never grows without bound. */
export function createLiveScanTimingLog(capacity = 500) {
  let samples: LiveScanSample[] = [];
  return {
    add(sample: LiveScanSample) {
      samples.push(sample);
      if (samples.length > capacity) samples = samples.slice(samples.length - capacity);
    },
    clear() {
      samples = [];
    },
    samples(): readonly LiveScanSample[] {
      return samples;
    },
    summary(): LiveScanSummary {
      return summarizeLiveScanSamples(samples);
    },
  };
}
