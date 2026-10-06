import type {
  CardSide,
  CornerPosition,
  EdgePosition,
  PregradeCriterion,
  PregradeDeduction,
  PregradeDeductionUnit,
  PregradeDefect,
  PregradeDefectCode,
  PregradeEstimate,
  PregradeQualifier,
  PregradeSubgrade,
} from '../types/pregrade.js';

export const PREGRADE_MODEL_VERSION = 'pregrade-deduction-1';
export const PREGRADE_LABEL = 'AI pre-grade estimate';
export const PREGRADE_DISCLAIMER = 'Not an official PSA, BGS, or CGC grade.';
export const NEEDS_DEFECTS_MESSAGE =
  'Structured defects are required. This endpoint does not estimate a grade from photos.';

export const PREGRADE_WEIGHTS = {
  surface: 0.32,
  edges: 0.25,
  corners: 0.25,
  centering: 0.18,
} as const;

export const PREGRADE_SCALE = { min: 1.0, max: 10.0 } as const;

export const PREGRADE_BLEND_WEIGHTS = {
  centering: { frontWeight: 100, backWeight: 70 },
  surface: { frontWeight: 100, backWeight: 70 },
  edges: { frontWeight: 70, backWeight: 100 },
  corners: { frontWeight: 70, backWeight: 100 },
} as const;

const SIDES: readonly CardSide[] = ['front', 'back'];
const EDGES: readonly EdgePosition[] = ['top', 'right', 'bottom', 'left'];
const CORNERS: readonly CornerPosition[] = [
  'topLeft',
  'topRight',
  'bottomLeft',
  'bottomRight',
];
const CRITERIA: readonly PregradeCriterion[] = ['centering', 'surface', 'edges', 'corners'];

const CENTERING_GRACE_PERCENT = 5;
const DISPLACEMENT_MIN = 1;
const DISPLACEMENT_MAX = 25;
const OC_QUANTITY = 20;
const OC_POINTS = 50;
const MC_QUANTITY = 80;
const MC_POINTS = 10;

interface DefectSpec {
  criterion: PregradeCriterion;
  pointsEach: number;
  unit: PregradeDeductionUnit;
  label: string;
  requiresEdge?: boolean;
  requiresCorner?: boolean;
}

export const PREGRADE_DEFECT_CATALOG: Record<PregradeDefectCode, DefectSpec> = {
  crease_per_cm2: {
    criterion: 'surface',
    pointsEach: -15,
    unit: 'cm2',
    label: 'Crease',
  },
  scratch_micro_per_cm2: {
    criterion: 'surface',
    pointsEach: -1,
    unit: 'cm2',
    label: 'Micro scratch',
  },
  scratch_standard_per_cm2: {
    criterion: 'surface',
    pointsEach: -5,
    unit: 'cm2',
    label: 'Scratch',
  },
  scratch_obvious_per_cm2: {
    criterion: 'surface',
    pointsEach: -10,
    unit: 'cm2',
    label: 'Obvious scratch',
  },
  dent_light: { criterion: 'surface', pointsEach: -5, unit: 'count', label: 'Light dent' },
  dent_medium: { criterion: 'surface', pointsEach: -10, unit: 'count', label: 'Medium dent' },
  dent_heavy: { criterion: 'surface', pointsEach: -20, unit: 'count', label: 'Heavy dent' },
  pressure_point: {
    criterion: 'surface',
    pointsEach: -1,
    unit: 'count',
    label: 'Pressure point',
  },
  pressure_marks: {
    criterion: 'surface',
    pointsEach: -5,
    unit: 'count',
    label: 'Pressure marks',
  },
  contamination_light: {
    criterion: 'surface',
    pointsEach: -5,
    unit: 'count',
    label: 'Light contamination',
  },
  contamination_heavy: {
    criterion: 'surface',
    pointsEach: -10,
    unit: 'count',
    label: 'Heavy contamination',
  },
  clouding_half: { criterion: 'surface', pointsEach: -25, unit: 'count', label: 'Half clouding' },
  clouding_full: { criterion: 'surface', pointsEach: -50, unit: 'count', label: 'Full clouding' },
  printline_micro: {
    criterion: 'surface',
    pointsEach: -5,
    unit: 'count',
    label: 'Micro print line',
  },
  printline_obvious: {
    criterion: 'surface',
    pointsEach: -10,
    unit: 'count',
    label: 'Print line',
  },
  printdot_mini: { criterion: 'surface', pointsEach: -1, unit: 'count', label: 'Mini print dot' },
  printdot_large: {
    criterion: 'surface',
    pointsEach: -5,
    unit: 'count',
    label: 'Large print dot',
  },
  displacement_full: {
    criterion: 'surface',
    pointsEach: -1,
    unit: 'points',
    label: 'Displacement',
  },
  whitening_dots_minimal: {
    criterion: 'surface',
    pointsEach: -1,
    unit: 'count',
    label: 'Whitening dots',
  },
  edge_wear_light_per_cm: {
    criterion: 'edges',
    pointsEach: -1,
    unit: 'cm',
    label: 'Light edge wear',
    requiresEdge: true,
  },
  edge_wear_medium_per_cm: {
    criterion: 'edges',
    pointsEach: -5,
    unit: 'cm',
    label: 'Medium edge wear',
    requiresEdge: true,
  },
  edge_wear_heavy_per_cm: {
    criterion: 'edges',
    pointsEach: -10,
    unit: 'cm',
    label: 'Heavy edge wear',
    requiresEdge: true,
  },
  factory_cut_deviation: {
    criterion: 'corners',
    pointsEach: -5,
    unit: 'count',
    label: 'Factory cut',
    requiresCorner: true,
  },
  factory_cut_partial: {
    criterion: 'corners',
    pointsEach: -10,
    unit: 'count',
    label: 'Partial factory cut',
    requiresCorner: true,
  },
  corner_whitening_minimal: {
    criterion: 'corners',
    pointsEach: -1,
    unit: 'count',
    label: 'Corner whitening',
    requiresCorner: true,
  },
  corner_wear_light: {
    criterion: 'corners',
    pointsEach: -3,
    unit: 'count',
    label: 'Light corner wear',
    requiresCorner: true,
  },
  corner_wear_medium: {
    criterion: 'corners',
    pointsEach: -5,
    unit: 'count',
    label: 'Medium corner wear',
    requiresCorner: true,
  },
  corner_wear_heavy: {
    criterion: 'corners',
    pointsEach: -10,
    unit: 'count',
    label: 'Heavy corner wear',
    requiresCorner: true,
  },
  corner_wear_very_heavy: {
    criterion: 'corners',
    pointsEach: -25,
    unit: 'count',
    label: 'Very heavy corner wear',
    requiresCorner: true,
  },
  centering_deviation: {
    criterion: 'centering',
    pointsEach: -1,
    unit: 'percent',
    label: 'Centering',
  },
};

export class InvalidPregradeDefectsError extends Error {
  readonly code = 'NEEDS_DEFECTS' as const;

  constructor(message = NEEDS_DEFECTS_MESSAGE) {
    super(message);
    this.name = 'InvalidPregradeDefectsError';
  }
}

function isCardSide(value: unknown): value is CardSide {
  return value === 'front' || value === 'back';
}

function isEdgePosition(value: unknown): value is EdgePosition {
  return typeof value === 'string' && (EDGES as readonly string[]).includes(value);
}

function isCornerPosition(value: unknown): value is CornerPosition {
  return typeof value === 'string' && (CORNERS as readonly string[]).includes(value);
}

function isDefectCode(value: unknown): value is PregradeDefectCode {
  return typeof value === 'string' && value in PREGRADE_DEFECT_CATALOG;
}

function fail(): never {
  throw new InvalidPregradeDefectsError();
}

export function parsePregradeDefects(input: unknown): PregradeDefect[] {
  if (!Array.isArray(input)) fail();

  const parsed: PregradeDefect[] = [];

  for (const row of input) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) fail();

    const record = row as Record<string, unknown>;
    if (!isDefectCode(record.code)) fail();
    if (typeof record.quantity !== 'number' || !Number.isInteger(record.quantity) || record.quantity < 0) {
      fail();
    }
    if (record.quantity === 0) continue;
    if (!isCardSide(record.side)) fail();

    const spec = PREGRADE_DEFECT_CATALOG[record.code];
    if (spec.requiresEdge && !isEdgePosition(record.edge)) fail();
    if (spec.requiresCorner && !isCornerPosition(record.corner)) fail();
    if (
      record.code === 'displacement_full' &&
      (record.quantity < DISPLACEMENT_MIN || record.quantity > DISPLACEMENT_MAX)
    ) {
      fail();
    }

    const defect: PregradeDefect = {
      code: record.code,
      side: record.side,
      quantity: record.quantity,
    };
    if (spec.requiresEdge && isEdgePosition(record.edge)) defect.edge = record.edge;
    if (spec.requiresCorner && isCornerPosition(record.corner)) defect.corner = record.corner;
    parsed.push(defect);
  }

  for (const side of SIDES) {
    const hasHalf = parsed.some((defect) => defect.side === side && defect.code === 'clouding_half');
    const hasFull = parsed.some((defect) => defect.side === side && defect.code === 'clouding_full');
    if (hasHalf && hasFull) fail();
  }

  return parsed;
}

function centeringDeduction(quantity: number): number {
  return Math.max(0, quantity - CENTERING_GRACE_PERCENT);
}

function toDeduction(defect: PregradeDefect): PregradeDeduction {
  const spec = PREGRADE_DEFECT_CATALOG[defect.code];
  const points =
    defect.code === 'centering_deviation'
      ? 0 - centeringDeduction(defect.quantity)
      : spec.pointsEach * defect.quantity;

  const row: PregradeDeduction = {
    code: defect.code,
    side: defect.side,
    points,
    quantity: defect.quantity,
    unit: spec.unit,
    pointsEach: spec.pointsEach,
    label: spec.label,
  };
  if (defect.code === 'centering_deviation') row.deviationPercent = defect.quantity;
  if (defect.edge) row.edge = defect.edge;
  if (defect.corner) row.corner = defect.corner;
  return row;
}

function emptySidePoints(): Record<CardSide, number> {
  return { front: 100, back: 100 };
}

export function blendCriterionPoints(
  front: number,
  back: number,
  frontWeight: number,
  backWeight: number
): number {
  return (front * frontWeight + back * backWeight) / (frontWeight + backWeight);
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function clampEstimate(value: number): number {
  return Math.min(PREGRADE_SCALE.max, Math.max(PREGRADE_SCALE.min, value));
}

function worseCenteringSide(
  quantities: Partial<Record<CardSide, number>>
): CardSide | null {
  const front = quantities.front;
  const back = quantities.back;
  if (front === undefined && back === undefined) return null;
  if (front === undefined) return 'back';
  if (back === undefined) return 'front';
  return back > front ? 'back' : 'front';
}

function qualifiersFor(
  quantities: Partial<Record<CardSide, number>>,
  sidePoints: Record<CardSide, number>
): PregradeQualifier[] {
  const side = worseCenteringSide(quantities);
  if (!side) return [];

  const quantity = quantities[side] ?? 0;
  const points = sidePoints[side];
  if (quantity >= MC_QUANTITY || points <= MC_POINTS) return ['MC'];
  if (quantity >= OC_QUANTITY || points <= OC_POINTS) return ['OC'];
  return [];
}

function scoreDefects(defects: PregradeDefect[]): PregradeEstimate {
  const sidePoints: Record<PregradeCriterion, Record<CardSide, number>> = {
    centering: emptySidePoints(),
    surface: emptySidePoints(),
    edges: emptySidePoints(),
    corners: emptySidePoints(),
  };

  const centeringQuantity: Partial<Record<CardSide, number>> = {};
  const centeringRows: Partial<Record<CardSide, PregradeDeduction>> = {};
  const deductions: PregradeDeduction[] = [];

  for (const defect of defects) {
    const spec = PREGRADE_DEFECT_CATALOG[defect.code];
    const row = toDeduction(defect);

    if (defect.code === 'centering_deviation') {
      const previous = centeringQuantity[defect.side];
      if (previous === undefined || defect.quantity > previous) {
        centeringQuantity[defect.side] = defect.quantity;
        centeringRows[defect.side] = row;
      }
      continue;
    }

    sidePoints[spec.criterion][defect.side] += row.points;
    deductions.push(row);
  }

  for (const side of SIDES) {
    const quantity = centeringQuantity[side];
    if (quantity === undefined) continue;
    const row = centeringRows[side];
    if (row) deductions.push(row);
    sidePoints.centering[side] = Math.max(0, 100 - centeringDeduction(quantity));
  }

  for (const criterion of CRITERIA) {
    for (const side of SIDES) {
      sidePoints[criterion][side] = Math.max(0, sidePoints[criterion][side]);
    }
  }

  const subgrades = {} as PregradeEstimate['subgrades'];
  for (const criterion of CRITERIA) {
    const { frontWeight, backWeight } = PREGRADE_BLEND_WEIGHTS[criterion];
    const front = sidePoints[criterion].front;
    const back = sidePoints[criterion].back;
    const subgrade: PregradeSubgrade = {
      points: blendCriterionPoints(front, back, frontWeight, backWeight),
      front,
      back,
      frontWeight,
      backWeight,
    };
    subgrades[criterion] = subgrade;
  }

  const finalPoints =
    PREGRADE_WEIGHTS.surface * subgrades.surface.points +
    PREGRADE_WEIGHTS.edges * subgrades.edges.points +
    PREGRADE_WEIGHTS.corners * subgrades.corners.points +
    PREGRADE_WEIGHTS.centering * subgrades.centering.points;

  return {
    label: PREGRADE_LABEL,
    disclaimer: PREGRADE_DISCLAIMER,
    modelVersion: PREGRADE_MODEL_VERSION,
    estimate: clampEstimate(roundToOneDecimal(finalPoints / 10)),
    finalPoints,
    scale: { min: PREGRADE_SCALE.min, max: PREGRADE_SCALE.max },
    weights: { ...PREGRADE_WEIGHTS },
    qualifiers: qualifiersFor(centeringQuantity, sidePoints.centering),
    subgrades,
    deductions,
  };
}

/**
 * Score structured defects only. Photos are never used.
 * An empty list is a clean card: every criterion 100, estimate 10.0.
 */
export function calculatePregrade(input: unknown): PregradeEstimate {
  return scoreDefects(parsePregradeDefects(input));
}
