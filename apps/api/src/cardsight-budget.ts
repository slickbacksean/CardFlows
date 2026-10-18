import { calendarMonthKey } from "@cardflow/shared";

export const CARDSIGHT_BUDGET_EXHAUSTED = "CardSight monthly budget is used up.";

export function consumeCardSightBudget(input: {
  consume: (provider: string, monthKey: string, cap: number) => boolean;
  cap: number | null;
  now: Date;
}): boolean {
  if (!input.cap) return true;
  return input.consume("cardsight", calendarMonthKey(input.now), input.cap);
}
