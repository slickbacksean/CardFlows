import {
  centsToDollarString,
  optionalDollarsToCents,
  roundHalfUpToCent,
} from "./money";
import type {
  ComputeMaxBuyInput,
  MaxBuyComputation,
  MaxBuyPreferences,
} from "./types";

/** NA beta is USD only. Header, Max Buy, and PATCH all use this — not a picker. */
export const LOCKED_DISPLAY_CURRENCY = "USD";

export const DEFAULT_MAX_BUY_PREFERENCES: MaxBuyPreferences = {
  targetMarginPct: 0.2,
  feesBufferPct: 0.13,
  conditionAdjustments: null,
  defaultCurrency: LOCKED_DISPLAY_CURRENCY,
};

export function withLockedDisplayCurrency(
  preferences: MaxBuyPreferences,
): MaxBuyPreferences {
  return {
    ...preferences,
    defaultCurrency: LOCKED_DISPLAY_CURRENCY,
    conditionAdjustments: sanitizeConditionAdjustments(preferences.conditionAdjustments),
  };
}

export const MAX_BUY_NOT_MARKET_PRICE_DISCLAIMER =
  "This is guidance from your rules, not a market price or guaranteed profit.";

export function sanitizeConditionAdjustments(
  adjustments: Record<string, number> | null | undefined,
): Record<string, number> | null {
  if (!adjustments) return null;
  const next: Record<string, number> = {};
  for (const [key, value] of Object.entries(adjustments)) {
    const label = key.trim();
    if (!label || typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    next[label] = value;
  }
  return Object.keys(next).length > 0 ? next : null;
}

export function resolveConditionFactor(
  condition: string | null | undefined,
  adjustments: Record<string, number> | null | undefined,
): number {
  if (!condition || !adjustments) return 1;
  const factor = adjustments[condition];
  if (typeof factor !== "number" || !Number.isFinite(factor) || factor < 0) return 1;
  return factor;
}

export function computeMaxBuy(input: ComputeMaxBuyInput): MaxBuyComputation {
  const preferences = withLockedDisplayCurrency({
    ...DEFAULT_MAX_BUY_PREFERENCES,
    ...input.preferences,
    conditionAdjustments:
      input.preferences?.conditionAdjustments === undefined
        ? DEFAULT_MAX_BUY_PREFERENCES.conditionAdjustments
        : input.preferences.conditionAdjustments,
  });
  const condition = input.condition ?? null;
  const conditionFactor = resolveConditionFactor(
    condition,
    preferences.conditionAdjustments,
  );
  const referencePriceCents = optionalDollarsToCents(input.referencePriceAmount);
  const referencePriceAmount =
    referencePriceCents === null
      ? null
      : centsToDollarString(referencePriceCents);
  if (referencePriceCents === null) {
    return {
      referencePriceAmount: null,
      referencePriceCents: null,
      referencePriceSource: "none",
      currency: preferences.defaultCurrency,
      currentTargetMarginPct: preferences.targetMarginPct,
      currentFeesBufferPct: preferences.feesBufferPct,
      currentConditionFactor: conditionFactor,
      condition,
      maxBuyAmount: null,
      maxBuyAmountCents: null,
      isRecomputedGuidance: true,
      display: "Enter a reference price to compute Max Buy.",
      disclaimer: MAX_BUY_NOT_MARKET_PRICE_DISCLAIMER,
    };
  }

  const factorProduct =
    (1 - preferences.targetMarginPct) *
    (1 - preferences.feesBufferPct) *
    conditionFactor;
  const maxBuyAmountCents = roundHalfUpToCent(
    referencePriceCents * factorProduct,
  );
  const maxBuyAmount = centsToDollarString(maxBuyAmountCents);

  return {
    referencePriceAmount,
    referencePriceCents,
    referencePriceSource: "user_entered",
    currency: preferences.defaultCurrency,
    currentTargetMarginPct: preferences.targetMarginPct,
    currentFeesBufferPct: preferences.feesBufferPct,
    currentConditionFactor: conditionFactor,
    condition,
    maxBuyAmount,
    maxBuyAmountCents,
    isRecomputedGuidance: true,
    display: `Based on your $${referencePriceAmount} reference, Max Buy: $${maxBuyAmount}`,
    disclaimer: MAX_BUY_NOT_MARKET_PRICE_DISCLAIMER,
  };
}

export function storedCopyReferencePriceAmount(copy: {
  referencePriceAmount?: string | number | null;
  purchase?: {
    maxBuy?: { referencePriceAmount?: string | number | null };
  } | null;
}): string | number | null {
  if (
    copy.referencePriceAmount !== undefined &&
    copy.referencePriceAmount !== null &&
    copy.referencePriceAmount !== ""
  ) {
    return copy.referencePriceAmount;
  }
  return copy.purchase?.maxBuy?.referencePriceAmount ?? null;
}

/** Live guidance from current prefs + stored reference. Rule snapshots are not truth. */
export function recomputeCopyMaxBuy(
  copy: {
    referencePriceAmount?: string | number | null;
    condition?: string | null;
    purchase?: {
      maxBuy?: { referencePriceAmount?: string | number | null };
    } | null;
  },
  preferences: MaxBuyPreferences,
): MaxBuyComputation {
  return computeMaxBuy({
    referencePriceAmount: storedCopyReferencePriceAmount(copy),
    condition: copy.condition,
    preferences,
  });
}

export function collectionTileValue(
  copy: {
    intent: "purchased" | "watchlist";
    allInTotal?: string | null;
    referencePriceAmount?: string | number | null;
    condition?: string | null;
    purchase?: {
      maxBuy?: { referencePriceAmount?: string | number | null };
    } | null;
  },
  preferences: MaxBuyPreferences,
): { allInAmount: string | null; targetMaxBuyDisplay: string | null } {
  if (copy.intent === "purchased") {
    return {
      allInAmount: copy.allInTotal ?? null,
      targetMaxBuyDisplay: null,
    };
  }
  const amount = recomputeCopyMaxBuy(copy, preferences).maxBuyAmount;
  return {
    allInAmount: null,
    targetMaxBuyDisplay: amount ? `$${amount}` : null,
  };
}

export function maxBuyRulesCopy(preferences = DEFAULT_MAX_BUY_PREFERENCES): string {
  return `Your rules: ${Math.round(preferences.targetMarginPct * 100)}% margin, ${Math.round(preferences.feesBufferPct * 100)}% fees buffer`;
}

export const MAX_BUY_MARGIN_INVALID_MESSAGE = "Margin must be between 0 and 99.";
export const MAX_BUY_FEES_BUFFER_INVALID_MESSAGE =
  "Fees buffer must be between 0 and 99.";
export const MAX_BUY_CONDITION_FACTOR_INVALID_MESSAGE =
  "Condition factor must be 0 or greater.";
export const MAX_BUY_RESET_NOT_SAVED_NOTICE =
  "Defaults filled. Tap Save rules to persist.";

function isStoredPercentInRange(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 0.99;
}

export function maxBuyPreferencesRangeError(
  preferences: Pick<MaxBuyPreferences, "targetMarginPct" | "feesBufferPct"> & {
    conditionAdjustments?: Record<string, unknown> | null;
  },
): string | null {
  if (!isStoredPercentInRange(preferences.targetMarginPct)) {
    return MAX_BUY_MARGIN_INVALID_MESSAGE;
  }
  if (!isStoredPercentInRange(preferences.feesBufferPct)) {
    return MAX_BUY_FEES_BUFFER_INVALID_MESSAGE;
  }
  const adjustments = preferences.conditionAdjustments;
  if (adjustments) {
    for (const value of Object.values(adjustments)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return MAX_BUY_CONDITION_FACTOR_INVALID_MESSAGE;
      }
    }
  }
  return null;
}

export interface MaxBuyRulesFormValues {
  targetMarginDisplay: string;
  feesBufferDisplay: string;
  conditionFactorNmDisplay: string;
  currency: string;
}

export function maxBuyPreferencesToFormValues(
  preferences: MaxBuyPreferences,
): MaxBuyRulesFormValues {
  const nm = preferences.conditionAdjustments?.NM;
  return {
    targetMarginDisplay: String(Math.round(preferences.targetMarginPct * 100)),
    feesBufferDisplay: String(Math.round(preferences.feesBufferPct * 100)),
    conditionFactorNmDisplay: formatConditionFactor(nm),
    currency: LOCKED_DISPLAY_CURRENCY,
  };
}

export function parseMaxBuyRulesForm(input: {
  targetMarginDisplay: string;
  feesBufferDisplay: string;
  conditionFactorNmDisplay: string;
  existingAdjustments?: Record<string, number> | null;
}): { ok: true; preferences: MaxBuyPreferences } | { ok: false; error: string } {
  const marginDisplay = parsePercentDisplay(input.targetMarginDisplay);
  if (marginDisplay === null || !isPercentInMarginRange(marginDisplay)) {
    return { ok: false, error: MAX_BUY_MARGIN_INVALID_MESSAGE };
  }
  const feesDisplay = parsePercentDisplay(input.feesBufferDisplay);
  if (feesDisplay === null || !isPercentInMarginRange(feesDisplay)) {
    return { ok: false, error: MAX_BUY_FEES_BUFFER_INVALID_MESSAGE };
  }
  const nmFactor = parseConditionFactor(input.conditionFactorNmDisplay);
  if (nmFactor === null) {
    return { ok: false, error: MAX_BUY_CONDITION_FACTOR_INVALID_MESSAGE };
  }

  return {
    ok: true,
    preferences: {
      targetMarginPct: marginDisplay / 100,
      feesBufferPct: feesDisplay / 100,
      defaultCurrency: LOCKED_DISPLAY_CURRENCY,
      conditionAdjustments: buildConditionAdjustments(
        nmFactor,
        input.existingAdjustments ?? null,
      ),
    },
  };
}

function parsePercentDisplay(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function isPercentInMarginRange(displayPct: number): boolean {
  return displayPct >= 0 && displayPct <= 99;
}

function parseConditionFactor(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return 1;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function formatConditionFactor(value: number | undefined): string {
  if (value === undefined) return "1.0";
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function buildConditionAdjustments(
  nmFactor: number,
  existing: Record<string, number> | null,
): Record<string, number> | null {
  if (existing == null) {
    return nmFactor === 1 ? null : { NM: nmFactor };
  }
  return { ...existing, NM: nmFactor };
}
