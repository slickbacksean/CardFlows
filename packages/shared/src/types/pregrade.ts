export type CardSide = 'front' | 'back';

export type EdgePosition = 'top' | 'right' | 'bottom' | 'left';

export type CornerPosition = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

export type PregradeQualifier = 'OC' | 'MC';

export type PregradeCriterion = 'centering' | 'surface' | 'edges' | 'corners';

export type PregradeDeductionUnit = 'cm2' | 'cm' | 'count' | 'points' | 'percent';

export type PregradeDefectCode =
  | 'crease_per_cm2'
  | 'scratch_micro_per_cm2'
  | 'scratch_standard_per_cm2'
  | 'scratch_obvious_per_cm2'
  | 'dent_light'
  | 'dent_medium'
  | 'dent_heavy'
  | 'pressure_point'
  | 'pressure_marks'
  | 'contamination_light'
  | 'contamination_heavy'
  | 'clouding_half'
  | 'clouding_full'
  | 'printline_micro'
  | 'printline_obvious'
  | 'printdot_mini'
  | 'printdot_large'
  | 'displacement_full'
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
  | 'centering_deviation';

export interface PregradeDefectInput {
  code: string;
  side: CardSide;
  quantity: number;
  corner?: CornerPosition;
  edge?: EdgePosition;
}

export interface PregradeDefect {
  code: PregradeDefectCode;
  side: CardSide;
  quantity: number;
  corner?: CornerPosition;
  edge?: EdgePosition;
}

export interface PregradeDeduction {
  code: PregradeDefectCode;
  side: CardSide;
  /** Points total for this row. Negative when a deduction applies. */
  points: number;
  quantity: number;
  unit: PregradeDeductionUnit;
  pointsEach: number;
  label: string;
  /** Echo of centering_deviation quantity so the row is not only a number. */
  deviationPercent?: number;
  corner?: CornerPosition;
  edge?: EdgePosition;
}

export interface PregradeSubgrade {
  /** Blended points out of 100 */
  points: number;
  /** Side points out of 100 */
  front: number;
  back: number;
  frontWeight: number;
  backWeight: number;
}

export interface PregradeScale {
  min: number;
  max: number;
}

export interface PregradeWeights {
  surface: number;
  edges: number;
  corners: number;
  centering: number;
}

export interface PregradeEstimate {
  label: string;
  disclaimer: string;
  modelVersion: string;
  /** Only 1.0–10.0 grade number in the response. */
  estimate: number;
  /** Always present, including when it equals estimate * 10. */
  finalPoints: number;
  scale: PregradeScale;
  weights: PregradeWeights;
  qualifiers: PregradeQualifier[];
  subgrades: {
    centering: PregradeSubgrade;
    surface: PregradeSubgrade;
    edges: PregradeSubgrade;
    corners: PregradeSubgrade;
  };
  deductions: PregradeDeduction[];
}
