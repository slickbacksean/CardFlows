import {
  measuredCenteringSubgrade,
  parseMeasuredCenteringRatios,
} from "./grade-centering";
import { wearScoresFromDefectCounts, type WearDefectCounts } from "./grade-wear";

export const GRADE_SUBGRADE_IDS = ["centering", "corners", "edges", "surface"] as const;
export type GradeSubgradeId = (typeof GRADE_SUBGRADE_IDS)[number];

export const GRADE_SIDES = ["front", "back"] as const;
export type GradeSide = (typeof GRADE_SIDES)[number];

export const GRADE_CONFIDENCE = ["high", "medium", "low"] as const;
export type GradeConfidence = (typeof GRADE_CONFIDENCE)[number];

export const GRADE_ESTIMATE_LABEL = "estimate" as const;
export const GRADE_ESTIMATE_DISCLAIMER =
  "AI pre-grade estimate. Not an official PSA, BGS, or CGC grade." as const;
export const GRADE_ESTIMATE_EMPTY_COPY = "No photo estimate yet." as const;
export const GRADE_ESTIMATE_UNAVAILABLE_COPY = "Estimate unavailable." as const;
export const GRADE_ESTIMATE_GUIDANCE_HISTORY_LABEL = "Guidance history" as const;
export const GRADE_PHOTOS_HINT =
  "Front and back photos are required for an AI pre-grade estimate. You can still submit without one." as const;
export const GRADE_ESTIMATE_NEEDS_BACK_COPY =
  "Add a back photo for an AI pre-grade estimate." as const;
export const GRADING_TAB_CONSTRAINT = "AI pre-grade estimate, not a cert." as const;

export const GRADE_FRONT_WEIGHT = 0.6;
export const GRADE_BACK_WEIGHT = 0.4;

/** API-env kill switch. Not a Settings toggle. CI stays on the mock provider. */
export const GRADE_ESTIMATE_ENABLED_FLAG = "grade_estimate_enabled" as const;

export const GRADE_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type GradeImageMimeType = (typeof GRADE_IMAGE_MIME_TYPES)[number];

export const GRADE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

export interface GradeSubgrade {
  id: GradeSubgradeId;
  side: GradeSide;
  score: number | null;
  ratio: string | null;
}

export interface CardFlowGradeEstimate {
  overall: number | null;
  display: string;
  confidence: GradeConfidence | null;
  subgrades: GradeSubgrade[];
  usedBack: boolean;
  label: typeof GRADE_ESTIMATE_LABEL;
  notACert: true;
  disclaimer: typeof GRADE_ESTIMATE_DISCLAIMER;
  mathTrace: string[];
}

export interface GradeImageInput {
  byteLength: number;
  mimeType?: string;
  bytes?: Uint8Array;
}

export interface GradeEstimateRequest {
  frontImage: GradeImageInput | null;
  backImage: GradeImageInput | null;
  mimeType?: string;
}

export type GradeEstimateProviderName = "mock" | "cardgrading" | "cnn" | "off";

export interface CardGradingProvider {
  readonly name: GradeEstimateProviderName;
  readonly featureDisabled?: boolean;
  estimateGrade(req: GradeEstimateRequest): Promise<CardFlowGradeEstimate>;
}

export function isGradeImageMime(value: string | null | undefined): value is GradeImageMimeType {
  return (
    typeof value === "string" &&
    (GRADE_IMAGE_MIME_TYPES as readonly string[]).includes(value)
  );
}

export function hasUsableGradeImage(
  image: GradeImageInput | null | undefined,
  fallbackMime?: string,
): boolean {
  if (!image || !Number.isFinite(image.byteLength) || image.byteLength <= 0) return false;
  if (image.byteLength > GRADE_IMAGE_MAX_BYTES) return false;
  return isGradeImageMime(image.mimeType ?? fallbackMime);
}

export function roundGrade(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const clamped = Math.min(10, Math.max(1, value));
  const whole = Math.floor(clamped + 1e-9);
  const frac = clamped - whole;
  if (frac < 0.25) return whole;
  if (frac < 0.75) return whole + 0.5;
  return Math.min(10, whole + 1);
}

function scoresForSide(subgrades: readonly GradeSubgrade[], side: GradeSide): number[] {
  return GRADE_SUBGRADE_IDS.map(
    (id) => subgrades.find((row) => row.id === id && row.side === side)?.score,
  ).filter(
    (score): score is number => typeof score === "number" && Number.isFinite(score) && score > 0,
  );
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatAvg(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

export function applyMeasuredCentering(subgrades: readonly GradeSubgrade[]): GradeSubgrade[] {
  return subgrades.map((row) => {
    if (row.id !== "centering") return { ...row };
    const measured = measuredCenteringSubgrade(parseMeasuredCenteringRatios(row.ratio));
    if (measured.score == null) return { ...row };
    return {
      ...row,
      score: measured.score,
      ratio: measured.ratio ?? row.ratio,
    };
  });
}

export function gradeBottleneck(subgrades: readonly GradeSubgrade[]): GradeSubgrade | null {
  const scored = subgrades.filter(
    (row): row is GradeSubgrade & { score: number } =>
      typeof row.score === "number" && Number.isFinite(row.score),
  );
  if (scored.length === 0) return null;
  return scored.reduce((lowest, row) => (row.score < lowest.score ? row : lowest));
}

export function computeOverallGrade(subgrades: readonly GradeSubgrade[]): {
  overall: number | null;
  usedBack: boolean;
  frontAvg: number | null;
  backAvg: number | null;
  lowest: number | null;
} {
  const resolved = applyMeasuredCentering(subgrades);
  const front = scoresForSide(resolved, "front");
  const back = scoresForSide(resolved, "back");
  const frontAvg = average(front);
  if (frontAvg === null) {
    return { overall: null, usedBack: false, frontAvg: null, backAvg: null, lowest: null };
  }

  const lowest = Math.min(...front, ...back);
  const backAvg = average(back);
  const raw = backAvg === null ? frontAvg : frontAvg * GRADE_FRONT_WEIGHT + backAvg * GRADE_BACK_WEIGHT;
  return {
    overall: roundGrade(Math.min(raw, lowest + 1)),
    usedBack: backAvg !== null,
    frontAvg,
    backAvg,
    lowest,
  };
}

function buildMathTrace(
  subgrades: readonly GradeSubgrade[],
  overall: number | null,
  usedBack: boolean,
  frontAvg: number | null,
  backAvg: number | null,
  lowest: number | null,
): string[] {
  const lines: string[] = [];
  for (const row of subgrades) {
    if (row.score == null) continue;
    if (row.id === "centering" && row.ratio) {
      lines.push(`centering ${row.side}=${row.score} from ${row.ratio}`);
      continue;
    }
    lines.push(`${row.id} ${row.side}=${row.score}`);
  }
  const bottleneck = gradeBottleneck(subgrades);
  if (bottleneck) {
    const ratio = bottleneck.ratio ? ` (${bottleneck.ratio})` : "";
    lines.push(`bottleneck: ${bottleneck.side} ${bottleneck.id} ${bottleneck.score}${ratio}`);
  }
  if (overall == null || frontAvg == null) {
    lines.push("overall=null — front scores required");
    return lines;
  }
  if (usedBack && backAvg != null && lowest != null) {
    lines.push(
      `overall=${overall} = frontAvg ${formatAvg(frontAvg)}×0.60 + backAvg ${formatAvg(backAvg)}×0.40, cap lowest ${lowest}+1`,
    );
    return lines;
  }
  lines.push(`overall=${overall} from front only (avg ${formatAvg(frontAvg)})`);
  return lines;
}

export function formatGradeDisplay(overall: number | null): string {
  if (overall === null) return "No estimate";
  return `Estimate ${overall}`;
}

export function emptyGradeSubgrades(): GradeSubgrade[] {
  return GRADE_SIDES.flatMap((side) =>
    GRADE_SUBGRADE_IDS.map((id) => ({ id, side, score: null, ratio: null })),
  );
}

/** Provider off. No numeric grade. Distinct from a missing photo. */
export function unavailableGradeEstimate(): CardFlowGradeEstimate {
  return {
    ...emptyGradeEstimate(),
    display: GRADE_ESTIMATE_UNAVAILABLE_COPY,
  };
}

/** Hard capture gate from the photo grader. No numeric grade. */
export function retakeGradeEstimate(reasons: readonly string[]): CardFlowGradeEstimate {
  const detail = reasons.filter((reason) => reason.trim() !== "").join(", ") || "Card not found";
  return {
    ...emptyGradeEstimate(),
    display: `Retake photos: ${detail}`,
    mathTrace: [`retake: ${detail}`],
  };
}

/** Photo grader needs both sides. No numeric grade. */
export function needsBackGradeEstimate(): CardFlowGradeEstimate {
  return {
    ...emptyGradeEstimate(),
    display: GRADE_ESTIMATE_NEEDS_BACK_COPY,
  };
}

export function emptyGradeEstimate(): CardFlowGradeEstimate {
  return {
    overall: null,
    display: "No estimate",
    confidence: null,
    subgrades: emptyGradeSubgrades(),
    usedBack: false,
    label: GRADE_ESTIMATE_LABEL,
    notACert: true,
    disclaimer: GRADE_ESTIMATE_DISCLAIMER,
    mathTrace: [],
  };
}

function capConfidenceWithoutBack(confidence: GradeConfidence | null): GradeConfidence | null {
  if (confidence === "high") return "medium";
  return confidence ?? "medium";
}

export function gradeEstimateFromSubgrades(
  subgrades: readonly GradeSubgrade[],
  confidence: GradeConfidence | null = null,
): CardFlowGradeEstimate {
  const resolved = applyMeasuredCentering(subgrades);
  const { overall, usedBack, frontAvg, backAvg, lowest } = computeOverallGrade(resolved);
  const nextConfidence =
    overall === null ? null : usedBack ? confidence : capConfidenceWithoutBack(confidence);
  const slots = emptyGradeSubgrades().map((slot) => {
    const match = resolved.find((row) => row.id === slot.id && row.side === slot.side);
    return match
      ? { id: slot.id, side: slot.side, score: match.score, ratio: match.ratio }
      : slot;
  });
  return {
    overall,
    display: formatGradeDisplay(overall),
    confidence: nextConfidence,
    subgrades: slots,
    usedBack,
    label: GRADE_ESTIMATE_LABEL,
    notACert: true,
    disclaimer: GRADE_ESTIMATE_DISCLAIMER,
    mathTrace: buildMathTrace(slots, overall, usedBack, frontAvg, backAvg, lowest),
  };
}

/**
 * Overall-only photo estimate (dual-branch CNN). Does not invent pillar subgrades.
 * Still labeled estimate / not a cert.
 */
export function gradeEstimateFromOverall(
  overall: number | null,
  options: {
    usedBack?: boolean;
    confidence?: GradeConfidence | null;
    mathTrace?: string[];
  } = {},
): CardFlowGradeEstimate {
  if (overall === null || !Number.isFinite(overall)) return emptyGradeEstimate();
  const score = roundGrade(overall);
  const usedBack = options.usedBack === true;
  const confidence = usedBack
    ? (options.confidence ?? "medium")
    : capConfidenceWithoutBack(options.confidence ?? "medium");
  const trace =
    options.mathTrace && options.mathTrace.length > 0
      ? options.mathTrace
      : [`overall=${score} from dual-branch CNN (no pillar subgrades)`];
  return {
    overall: score,
    display: formatGradeDisplay(score),
    confidence,
    subgrades: emptyGradeSubgrades(),
    usedBack,
    label: GRADE_ESTIMATE_LABEL,
    notACert: true,
    disclaimer: GRADE_ESTIMATE_DISCLAIMER,
    mathTrace: trace,
  };
}

export function confidenceLabel(confidence: GradeConfidence | null): string | null {
  if (!confidence) return null;
  return `${confidence.slice(0, 1).toUpperCase()}${confidence.slice(1)} confidence`;
}

export function serializeGradeEstimate(estimate: CardFlowGradeEstimate): string {
  return JSON.stringify(estimate);
}

export function parseStoredGradeEstimate(
  json: string | null | undefined,
): CardFlowGradeEstimate | null {
  if (typeof json !== "string" || json.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.notACert !== true) return null;
    const overall =
      typeof record.overall === "number" && Number.isFinite(record.overall) ? record.overall : null;
    const confidence =
      record.confidence === "high" || record.confidence === "medium" || record.confidence === "low"
        ? record.confidence
        : null;
    const display =
      typeof record.display === "string" && record.display.trim()
        ? record.display
        : formatGradeDisplay(overall);
    return {
      ...emptyGradeEstimate(),
      overall,
      display,
      confidence,
      usedBack: record.usedBack === true,
    };
  } catch {
    return null;
  }
}

export const MOCK_GRADE_FRONT_CENTERING = { left: 58, right: 42 } as const;
export const MOCK_GRADE_BACK_CENTERING = { left: 55, right: 45 } as const;
export const MOCK_GRADE_WEAR_COUNTS: WearDefectCounts = {
  corners: 1,
  edges: 1,
  surface: 0,
};

function mockSubgrades(hasBack: boolean): GradeSubgrade[] {
  const frontCentering = measuredCenteringSubgrade({ lr: MOCK_GRADE_FRONT_CENTERING });
  const wear = wearScoresFromDefectCounts(MOCK_GRADE_WEAR_COUNTS);
  const rows: GradeSubgrade[] = [
    {
      id: "centering",
      side: "front",
      score: frontCentering.score,
      ratio: frontCentering.ratio,
    },
    { id: "corners", side: "front", score: wear.corners, ratio: null },
    { id: "edges", side: "front", score: wear.edges, ratio: null },
    { id: "surface", side: "front", score: wear.surface, ratio: null },
  ];
  if (!hasBack) return rows;
  const backCentering = measuredCenteringSubgrade({ lr: MOCK_GRADE_BACK_CENTERING });
  rows.push(
    {
      id: "centering",
      side: "back",
      score: backCentering.score,
      ratio: backCentering.ratio,
    },
    { id: "corners", side: "back", score: wear.corners, ratio: null },
    { id: "edges", side: "back", score: wear.edges, ratio: null },
    { id: "surface", side: "back", score: wear.surface, ratio: null },
  );
  return rows;
}

/** Flag off → empty DTO, never an exception. */
export function createOffCardGradingProvider(): CardGradingProvider {
  return {
    name: "off",
    featureDisabled: true,
    async estimateGrade() {
      return unavailableGradeEstimate();
    },
  };
}

export const offCardGradingProvider = createOffCardGradingProvider();

/** Fixture estimate for CI. Never calls the network. */
export function createMockCardGradingProvider(): CardGradingProvider {
  return {
    name: "mock",
    async estimateGrade(req) {
      const hasFront = hasUsableGradeImage(req.frontImage, req.mimeType);
      if (!hasFront) return emptyGradeEstimate();
      const hasBack = hasUsableGradeImage(req.backImage, req.mimeType);
      return gradeEstimateFromSubgrades(mockSubgrades(hasBack), hasBack ? "high" : "medium");
    },
  };
}

export const mockCardGradingProvider = createMockCardGradingProvider();
