export type ReferencePriceSource = 'user_entered' | 'later_provider' | 'none';

export interface MaxBuyUserPreferences {
  maxBuyTargetMarginPct: number;
  maxBuyFeesBufferPct: number;
  maxBuyConditionAdjustmentsJson: Record<string, number> | null;
  defaultCurrency: string;
}

export interface MaxBuyInput {
  /** Reference price in dollars as a decimal string (e.g. "8.00"). Null when missing. */
  referencePriceAmount: string | null;
  referencePriceSource?: ReferencePriceSource;
  condition: string | null;
  preferences: MaxBuyUserPreferences;
}

export interface MaxBuyResult {
  referencePriceAmount: string | null;
  referencePriceSource: ReferencePriceSource;
  currency: string;
  currentTargetMarginPct: number;
  currentFeesBufferPct: number;
  currentConditionFactor: number;
  condition: string | null;
  /** Display dollars (e.g. "5.57") */
  maxBuyAmount: string | null;
  /** Persisted minor units (e.g. 557) */
  maxBuyAmountCents: number | null;
  isRecomputedGuidance: true;
}

export const DEFAULT_MAX_BUY_PREFERENCES: MaxBuyUserPreferences = {
  maxBuyTargetMarginPct: 0.2,
  maxBuyFeesBufferPct: 0.13,
  maxBuyConditionAdjustmentsJson: null,
  defaultCurrency: 'USD',
};

export const MISSING_REFERENCE_UI_COPY = 'Enter a reference price to compute Max Buy.';
