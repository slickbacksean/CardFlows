import type { MaxBuyInput, MaxBuyResult } from '../types/max-buy.js';
import { DEFAULT_MAX_BUY_PREFERENCES } from '../types/max-buy.js';
import { centsToDollars, dollarsToCents } from './money.js';

export function getConditionFactor(
  condition: string | null,
  adjustments: Record<string, number> | null
): number {
  if (!condition || !adjustments) {
    return 1.0;
  }
  return adjustments[condition] ?? 1.0;
}

/**
 * Max Buy guidance: round_half_up_cent(reference × (1 − margin) × (1 − fees) × condition_factor).
 * Persist cents, display dollars. Returns null max buy when reference is missing.
 */
export function calculateMaxBuy(input: MaxBuyInput): MaxBuyResult {
  const preferences = input.preferences ?? DEFAULT_MAX_BUY_PREFERENCES;
  const conditionFactor = getConditionFactor(
    input.condition,
    preferences.maxBuyConditionAdjustmentsJson
  );

  const base: MaxBuyResult = {
    referencePriceAmount: input.referencePriceAmount,
    referencePriceSource: input.referencePriceSource ?? (input.referencePriceAmount ? 'user_entered' : 'none'),
    currency: preferences.defaultCurrency,
    currentTargetMarginPct: preferences.maxBuyTargetMarginPct,
    currentFeesBufferPct: preferences.maxBuyFeesBufferPct,
    currentConditionFactor: conditionFactor,
    condition: input.condition,
    maxBuyAmount: null,
    maxBuyAmountCents: null,
    isRecomputedGuidance: true,
  };

  if (!input.referencePriceAmount) {
    return base;
  }

  const referenceCents = dollarsToCents(input.referencePriceAmount);
  const factorProduct =
    (1 - preferences.maxBuyTargetMarginPct) *
    (1 - preferences.maxBuyFeesBufferPct) *
    conditionFactor;

  const maxBuyCents = Math.round(referenceCents * factorProduct);

  return {
    ...base,
    maxBuyAmount: centsToDollars(maxBuyCents),
    maxBuyAmountCents: maxBuyCents,
  };
}
