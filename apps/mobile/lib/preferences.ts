import {
  DEFAULT_MAX_BUY_PREFERENCES,
  LOCKED_DISPLAY_CURRENCY,
  maxBuyPreferencesRangeError,
  type MaxBuyPreferences,
  withLockedDisplayCurrency,
} from "@cardflow/shared";
import { getPreferences, patchPreferences } from "./api";
import { peekActiveUserId } from "./identity";

/** Last successful GET/PATCH only. Not a second source of truth. */
const lastSuccessfulByUserId = new Map<string, MaxBuyPreferences>();

function clonePreferences(preferences: MaxBuyPreferences): MaxBuyPreferences {
  return {
    targetMarginPct: preferences.targetMarginPct,
    feesBufferPct: preferences.feesBufferPct,
    defaultCurrency: LOCKED_DISPLAY_CURRENCY,
    conditionAdjustments: preferences.conditionAdjustments
      ? { ...preferences.conditionAdjustments }
      : null,
  };
}

function rememberSuccessful(preferences: MaxBuyPreferences): MaxBuyPreferences {
  const cloned = clonePreferences(preferences);
  lastSuccessfulByUserId.set(peekActiveUserId(), cloned);
  return clonePreferences(cloned);
}

export async function loadMaxBuyPreferences(): Promise<MaxBuyPreferences> {
  const result = await getPreferences();
  return rememberSuccessful(result.preferences);
}

export async function saveMaxBuyPreferences(
  preferences: MaxBuyPreferences,
): Promise<MaxBuyPreferences> {
  const rangeError = maxBuyPreferencesRangeError(preferences);
  if (rangeError) {
    throw new Error(rangeError);
  }
  const result = await patchPreferences(withLockedDisplayCurrency(preferences));
  return rememberSuccessful(result.preferences);
}

export function peekMaxBuyPreferences(): MaxBuyPreferences {
  const stored = lastSuccessfulByUserId.get(peekActiveUserId());
  return clonePreferences(stored ?? DEFAULT_MAX_BUY_PREFERENCES);
}
