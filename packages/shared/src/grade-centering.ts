/** PSA-style larger-share thresholds. Estimate only — not a cert. */
export const PSA_CENTERING_THRESHOLDS = [
  { maxLargerShare: 55, score: 10 },
  { maxLargerShare: 60, score: 9 },
  { maxLargerShare: 65, score: 8 },
  { maxLargerShare: 70, score: 7 },
  { maxLargerShare: 75, score: 6 },
  { maxLargerShare: 80, score: 5 },
  { maxLargerShare: 85, score: 4 },
  { maxLargerShare: 90, score: 3 },
  { maxLargerShare: 95, score: 2 },
] as const;

export interface CenteringAxis {
  left: number;
  right: number;
}

export interface MeasuredCentering {
  lr?: CenteringAxis | null;
  tb?: CenteringAxis | null;
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function largerShare(left: number, right: number): number | null {
  if (!finiteNonNegative(left) || !finiteNonNegative(right)) return null;
  const total = left + right;
  if (total <= 0) return null;
  return (Math.max(left, right) / total) * 100;
}

export function formatCenteringRatio(left: number, right: number): string | null {
  if (!finiteNonNegative(left) || !finiteNonNegative(right)) return null;
  const total = left + right;
  if (total <= 0) return null;
  const leftPct = Math.round((left / total) * 100);
  return `${leftPct}/${100 - leftPct}`;
}

export function parseCenteringRatio(ratio: string | null | undefined): CenteringAxis | null {
  const match = ratio?.trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const left = Number(match[1]);
  const right = Number(match[2]);
  if (!finiteNonNegative(left) || !finiteNonNegative(right) || left + right <= 0) return null;
  return { left, right };
}

export function centeringScoreFromShare(share: number | null): number | null {
  if (share === null || !Number.isFinite(share) || share < 50) return null;
  for (const row of PSA_CENTERING_THRESHOLDS) {
    if (share <= row.maxLargerShare) return row.score;
  }
  return 1;
}

export function centeringScoreFromAxis(axis: CenteringAxis | null | undefined): number | null {
  if (!axis) return null;
  return centeringScoreFromShare(largerShare(axis.left, axis.right));
}

/**
 * Measured centering subgrade. L/R is the reliable axis; T/B only tightens the score
 * when present. Unmeasured returns null — never invent an 8.
 */
export function measuredCenteringSubgrade(input: MeasuredCentering): {
  score: number | null;
  ratio: string | null;
  measured: boolean;
} {
  const lrScore = centeringScoreFromAxis(input.lr ?? null);
  const tbScore = centeringScoreFromAxis(input.tb ?? null);
  const lrRatio = input.lr ? formatCenteringRatio(input.lr.left, input.lr.right) : null;
  const tbRatio = input.tb ? formatCenteringRatio(input.tb.left, input.tb.right) : null;
  const ratio = [lrRatio, tbRatio].filter(Boolean).join(" · ") || null;
  const scores = [lrScore, tbScore].filter(
    (score): score is number => typeof score === "number",
  );
  if (scores.length === 0) return { score: null, ratio, measured: false };
  return { score: Math.min(...scores), ratio, measured: true };
}

export function parseMeasuredCenteringRatios(
  ratio: string | null | undefined,
): MeasuredCentering {
  if (!ratio?.trim()) return {};
  const parts = ratio.split("·").map((part) => part.trim()).filter(Boolean);
  return {
    lr: parts[0] ? parseCenteringRatio(parts[0]) : null,
    tb: parts[1] ? parseCenteringRatio(parts[1]) : null,
  };
}
