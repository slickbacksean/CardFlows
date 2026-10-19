import { calendarMonthKey } from "@cardflow/shared";

export const CARDSIGHT_BUDGET_EXHAUSTED = "CardSight monthly budget is used up.";

/** Alert when total CardSight calls this month reach this fraction of the cap (free plan ~80%). */
export const CARDSIGHT_USAGE_ALERT_RATIO = 0.8;

export function consumeCardSightBudget(input: {
  consume: (provider: string, monthKey: string, cap: number) => boolean;
  getUsage?: (provider: string, monthKey: string) => number;
  cap: number | null;
  now: Date;
  /** Called after a successful consume with the new used count (for the ~80% alert). */
  onUsage?: (used: number, cap: number) => void;
}): boolean {
  if (!input.cap) return true;
  const monthKey = calendarMonthKey(input.now);
  const ok = input.consume("cardsight", monthKey, input.cap);
  if (ok && input.onUsage && input.getUsage) {
    input.onUsage(input.getUsage("cardsight", monthKey), input.cap);
  }
  return ok;
}

/**
 * CardMagic may run only while total CardSight calls this month (ID + CardMagic)
 * are below `cap - reserve`. Card ID keeps the full cap.
 */
export function canCardMagicUseBudget(used: number, cap: number, reserve: number): boolean {
  const magicCeiling = Math.max(0, cap - Math.max(0, reserve));
  return used < magicCeiling;
}

export function shouldAlertCardSightUsage(used: number, cap: number): boolean {
  if (cap <= 0) return false;
  return used >= Math.ceil(cap * CARDSIGHT_USAGE_ALERT_RATIO);
}
