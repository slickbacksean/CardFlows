import {
  DEFAULT_MAX_BUY_PREFERENCES,
  LOCKED_DISPLAY_CURRENCY,
  withLockedDisplayCurrency,
} from "./max-buy";
import type { MaxBuyPreferences } from "./types";

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

/** In-memory Max Buy rules keyed by invited `user_id`. One store per mock API process. */
export function createUserPreferencesStore() {
  const preferencesByUserId = new Map<string, MaxBuyPreferences>();
  return {
    get(userId: string): MaxBuyPreferences {
      const stored = preferencesByUserId.get(userId);
      if (!stored) return clonePreferences(DEFAULT_MAX_BUY_PREFERENCES);
      const cleaned = withLockedDisplayCurrency(stored);
      if (
        JSON.stringify(cleaned.conditionAdjustments) !==
        JSON.stringify(stored.conditionAdjustments ?? null)
      ) {
        preferencesByUserId.set(userId, cleaned);
      }
      return clonePreferences(cleaned);
    },
    set(userId: string, next: MaxBuyPreferences): MaxBuyPreferences {
      const cleaned = withLockedDisplayCurrency(next);
      preferencesByUserId.set(userId, cleaned);
      return clonePreferences(cleaned);
    },
  };
}
