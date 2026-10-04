import type {
  CardSide,
  CornerPosition,
  EdgePosition,
  PregradeDefectCode,
  PregradeDefectInput,
} from '@cardflows/shared';

export const EDGE_CODES: readonly PregradeDefectCode[] = [
  'whitening_dots_minimal',
  'edge_wear_light_per_cm',
  'edge_wear_medium_per_cm',
  'edge_wear_heavy_per_cm',
];

export const CORNER_CODES: readonly PregradeDefectCode[] = [
  'factory_cut_deviation',
  'factory_cut_partial',
  'corner_whitening_minimal',
  'corner_wear_light',
  'corner_wear_medium',
  'corner_wear_heavy',
  'corner_wear_very_heavy',
];

export const EDGES: readonly EdgePosition[] = ['top', 'right', 'bottom', 'left'];
export const CORNERS: readonly CornerPosition[] = [
  'topLeft',
  'topRight',
  'bottomLeft',
  'bottomRight',
];

export const DEFECT_LABELS: Record<PregradeDefectCode, string> = {
  crease_per_cm2: 'Crease',
  scratch_micro_per_cm2: 'Micro scratch',
  scratch_standard_per_cm2: 'Scratch',
  scratch_obvious_per_cm2: 'Obvious scratch',
  dent_light: 'Light dent',
  dent_medium: 'Medium dent',
  dent_heavy: 'Heavy dent',
  pressure_point: 'Pressure point',
  pressure_marks: 'Pressure marks',
  contamination_light: 'Light contamination',
  contamination_heavy: 'Heavy contamination',
  clouding_half: 'Half clouding',
  clouding_full: 'Full clouding',
  printline_micro: 'Micro print line',
  printline_obvious: 'Print line',
  printdot_mini: 'Mini print dot',
  printdot_large: 'Large print dot',
  displacement_full: 'Displacement',
  whitening_dots_minimal: 'Whitening dots',
  edge_wear_light_per_cm: 'Light edge wear',
  edge_wear_medium_per_cm: 'Medium edge wear',
  edge_wear_heavy_per_cm: 'Heavy edge wear',
  factory_cut_deviation: 'Factory cut',
  factory_cut_partial: 'Partial factory cut',
  corner_whitening_minimal: 'Corner whitening',
  corner_wear_light: 'Light corner wear',
  corner_wear_medium: 'Medium corner wear',
  corner_wear_heavy: 'Heavy corner wear',
  corner_wear_very_heavy: 'Very heavy corner wear',
  centering_deviation: 'Centering',
};

export const EDGE_LABELS: Record<EdgePosition, string> = {
  top: 'Top',
  right: 'Right',
  bottom: 'Bottom',
  left: 'Left',
};

export const CORNER_LABELS: Record<CornerPosition, string> = {
  topLeft: 'Top left',
  topRight: 'Top right',
  bottomLeft: 'Bottom left',
  bottomRight: 'Bottom right',
};

export const SIDE_LABELS: Record<CardSide, string> = {
  front: 'Front',
  back: 'Back',
};

export interface DefectDraft {
  code: PregradeDefectCode;
  side: CardSide;
  quantity: number;
  edge?: EdgePosition;
  corner?: CornerPosition;
}

export function isEdgeCode(code: PregradeDefectCode): boolean {
  return EDGE_CODES.includes(code);
}

export function isCornerCode(code: PregradeDefectCode): boolean {
  return CORNER_CODES.includes(code);
}

export function defectKey(draft: Pick<DefectDraft, 'code' | 'side' | 'edge' | 'corner'>): string {
  if (isEdgeCode(draft.code)) return `${draft.side}:${draft.code}:${draft.edge ?? ''}`;
  if (isCornerCode(draft.code)) return `${draft.side}:${draft.code}:${draft.corner ?? ''}`;
  return `${draft.side}:${draft.code}`;
}

export function quantityBounds(code: PregradeDefectCode): { min: number; max: number } {
  if (code === 'displacement_full') return { min: 0, max: 25 };
  if (code === 'centering_deviation') return { min: 0, max: 100 };
  if (code === 'clouding_half' || code === 'clouding_full') return { min: 0, max: 1 };
  return { min: 0, max: 99 };
}

export function upsertDraft(drafts: DefectDraft[], next: DefectDraft): DefectDraft[] {
  const key = defectKey(next);
  const without = drafts.filter((draft) => defectKey(draft) !== key);
  if (next.quantity <= 0) return without;

  let nextDrafts = without;
  if (next.code === 'clouding_half') {
    nextDrafts = nextDrafts.filter(
      (draft) => !(draft.side === next.side && draft.code === 'clouding_full')
    );
  }
  if (next.code === 'clouding_full') {
    nextDrafts = nextDrafts.filter(
      (draft) => !(draft.side === next.side && draft.code === 'clouding_half')
    );
  }

  return [...nextDrafts, next];
}

export function draftQuantity(
  drafts: DefectDraft[],
  lookup: Pick<DefectDraft, 'code' | 'side' | 'edge' | 'corner'>
): number {
  return drafts.find((draft) => defectKey(draft) === defectKey(lookup))?.quantity ?? 0;
}

export function toDefectsPayload(drafts: DefectDraft[]): PregradeDefectInput[] {
  return drafts
    .filter((draft) => Number.isInteger(draft.quantity) && draft.quantity > 0)
    .map((draft) => {
      const row: PregradeDefectInput = {
        code: draft.code,
        side: draft.side,
        quantity: draft.quantity,
      };
      if (isEdgeCode(draft.code) && draft.edge) row.edge = draft.edge;
      if (isCornerCode(draft.code) && draft.corner) row.corner = draft.corner;
      return row;
    });
}

export function markedCount(drafts: DefectDraft[]): number {
  return toDefectsPayload(drafts).length;
}

export function formatPoints(points: number): string {
  if (points === 0) return '0';
  return points > 0 ? `+${points}` : `${points}`;
}

export function formatDeductionMeta(input: {
  code: PregradeDefectCode;
  side: CardSide;
  deviationPercent?: number;
  edge?: EdgePosition;
  corner?: CornerPosition;
}): string {
  const parts = [DEFECT_LABELS[input.code], SIDE_LABELS[input.side]];
  if (input.code === 'centering_deviation' && input.deviationPercent !== undefined) {
    parts.push(`${input.deviationPercent}%`);
  }
  if (input.edge) parts.push(EDGE_LABELS[input.edge]);
  if (input.corner) parts.push(CORNER_LABELS[input.corner]);
  return parts.join(' · ');
}

export interface SurfaceControl {
  code: Exclude<
    PregradeDefectCode,
    | 'clouding_half'
    | 'clouding_full'
    | 'whitening_dots_minimal'
    | 'edge_wear_light_per_cm'
    | 'edge_wear_medium_per_cm'
    | 'edge_wear_heavy_per_cm'
    | 'factory_cut_deviation'
    | 'factory_cut_partial'
    | 'corner_whitening_minimal'
    | 'corner_wear_light'
    | 'corner_wear_medium'
    | 'corner_wear_heavy'
    | 'corner_wear_very_heavy'
    | 'centering_deviation'
  >;
  hint: string;
}

export const SURFACE_CONTROLS: SurfaceControl[] = [
  { code: 'crease_per_cm2', hint: 'Area in cm²' },
  { code: 'scratch_micro_per_cm2', hint: 'Area in cm²' },
  { code: 'scratch_standard_per_cm2', hint: 'Area in cm²' },
  { code: 'scratch_obvious_per_cm2', hint: 'Area in cm²' },
  { code: 'dent_light', hint: 'Count' },
  { code: 'dent_medium', hint: 'Count' },
  { code: 'dent_heavy', hint: 'Count' },
  { code: 'pressure_point', hint: 'Count' },
  { code: 'pressure_marks', hint: 'Count' },
  { code: 'contamination_light', hint: 'Count' },
  { code: 'contamination_heavy', hint: 'Count' },
  { code: 'printline_micro', hint: 'Count' },
  { code: 'printline_obvious', hint: 'Count' },
  { code: 'printdot_mini', hint: 'Count' },
  { code: 'printdot_large', hint: 'Count' },
  { code: 'displacement_full', hint: 'Points 1–25' },
];

export const EDGE_CONTROLS: { code: (typeof EDGE_CODES)[number]; hint: string }[] = [
  { code: 'whitening_dots_minimal', hint: 'Count' },
  { code: 'edge_wear_light_per_cm', hint: 'Length in cm' },
  { code: 'edge_wear_medium_per_cm', hint: 'Length in cm' },
  { code: 'edge_wear_heavy_per_cm', hint: 'Length in cm' },
];

export const CORNER_CONTROLS: { code: (typeof CORNER_CODES)[number]; hint: string }[] = [
  { code: 'factory_cut_deviation', hint: 'Count' },
  { code: 'factory_cut_partial', hint: 'Count' },
  { code: 'corner_whitening_minimal', hint: 'Count' },
  { code: 'corner_wear_light', hint: 'Count' },
  { code: 'corner_wear_medium', hint: 'Count' },
  { code: 'corner_wear_heavy', hint: 'Count' },
  { code: 'corner_wear_very_heavy', hint: 'Count' },
];
