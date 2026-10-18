/**
 * Monthly pre-grade estimate quotas per account (P0-11 / D9).
 * Free: 5 per month. Premium: 30. The month runs from the user's own reset date (billing date,
 * or account creation date for free users), not the calendar month. Unused allowance doesn't roll
 * over. Bought credits are spent only after the allowance and never expire (Sean, Oct 16; Apple
 * 3.1.1). Copy never says "AI" and never
 * names a grading company.
 */
import { resetDateLabel } from "./quota-period";

export const GRADE_PLAN_FREE = "free" as const;
export const GRADE_PLAN_PREMIUM = "premium" as const;

export const GRADE_PLANS = [GRADE_PLAN_FREE, GRADE_PLAN_PREMIUM] as const;
export type GradePlan = (typeof GRADE_PLANS)[number];

// TODO(Sean, Oct 18 tiers): the new spec says quick = 10/month free, unlimited on Premium.
// Kept at 5 / 30 here on purpose (no billing redesign in the full-grade change); update together
// with the paywall, sign-up and App Review copy that quote these numbers.
export const GRADE_QUOTA_FREE_PER_MONTH = 5;
export const GRADE_QUOTA_PREMIUM_PER_MONTH = 30;

/** Default CardSight identify budget (vendor free tier). */
export const CARDSIGHT_MONTHLY_BUDGET_DEFAULT = 750;

/** Policy Reviewer (exact copy): the allowance resets, bought credits never expire. */
export const CREDITS_NEVER_EXPIRE_COPY =
  "Your monthly allowance resets on your reset date and unused monthly estimates don't roll over. Credits you buy never expire.";

export const GRADE_QUOTA_COPY = {
  remainingOne: "1 pre-grade estimate left this month",
  outOfGrades: "You're out of pre-grade estimates this month.",
  outOfGradesHint:
    // Policy Reviewer (exact): only the monthly allowance resets; bought credits never expire.
    "Your monthly allowance resets on your reset date and unused monthly estimates don't roll over. Credits you buy never expire.",
  creditsOne: "1 extra credit available",
  iapUnavailable: "Purchases aren't available yet.",
  getExtra: "Get extra estimates",
  consumeUnavailable: "No pre-grade estimate was used.",
} as const;

export function remainingMonthlyLabel(remaining: number): string {
  const n = Math.max(0, Math.floor(remaining));
  if (n === 1) return GRADE_QUOTA_COPY.remainingOne;
  return `${n} pre-grade estimates left this month`;
}

export function extraCreditsLabel(credits: number): string {
  const n = Math.max(0, Math.floor(credits));
  if (n === 1) return GRADE_QUOTA_COPY.creditsOne;
  return `${n} extra credits available`;
}

export function remainingGradesCaption(input: {
  remainingMonthly: number;
  extraCredits: number;
  remainingGrades: number;
  /** When present, the caption ends with the user's own reset date ("Resets Nov 15"). */
  resetsAt?: string;
}): string {
  const reset = input.resetsAt ? resetDateLabel(input.resetsAt) : "";
  const withReset = (text: string) => (reset ? `${text.replace(/\.$/, "")}. ${reset}.` : text);
  if (input.remainingGrades <= 0) return withReset(GRADE_QUOTA_COPY.outOfGrades);
  const monthly = remainingMonthlyLabel(input.remainingMonthly);
  if (input.extraCredits > 0) return withReset(`${monthly}. ${extraCreditsLabel(input.extraCredits)}.`);
  return withReset(monthly);
}

export function isGradePlan(value: string): value is GradePlan {
  return value === GRADE_PLAN_FREE || value === GRADE_PLAN_PREMIUM;
}

export function monthlyLimitForPlan(plan: GradePlan): number {
  return plan === GRADE_PLAN_PREMIUM ? GRADE_QUOTA_PREMIUM_PER_MONTH : GRADE_QUOTA_FREE_PER_MONTH;
}

/** UTC calendar month `YYYY-MM`. Server and clients share this clock. */
export function calendarMonthKey(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function nextMonthResetAt(now: Date): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return month === 11 ? new Date(Date.UTC(year + 1, 0, 1)) : new Date(Date.UTC(year, month + 1, 1));
}

export interface GradeQuotaSnapshot {
  plan: GradePlan;
  month: string;
  monthlyLimit: number;
  usedThisMonth: number;
  remainingMonthly: number;
  extraCredits: number;
  remainingGrades: number;
  resetsAt: string;
  iapEnabled: boolean;
  /** Full 14-photo grade allowance; absent while CARD_FLOW_GRADE_FULL_MODE is off. */
  fullGrade?: { monthlyLimit: number; usedThisMonth: number; remaining: number };
}

export function gradeQuotaSnapshot(input: {
  plan: GradePlan;
  usedThisMonth: number;
  extraCredits: number;
  iapEnabled: boolean;
  now: Date;
  /** The user's own allowance period (see quota-period.ts). Calendar month when omitted. */
  period?: { key: string; resetsAt: string };
}): GradeQuotaSnapshot {
  const used = Math.max(0, Math.floor(input.usedThisMonth));
  const extraCredits = Math.max(0, Math.floor(input.extraCredits));
  const monthlyLimit = monthlyLimitForPlan(input.plan);
  const remainingMonthly = Math.max(0, monthlyLimit - used);
  return {
    plan: input.plan,
    month: input.period?.key ?? calendarMonthKey(input.now),
    monthlyLimit,
    usedThisMonth: used,
    remainingMonthly,
    extraCredits,
    remainingGrades: remainingMonthly + extraCredits,
    resetsAt: input.period?.resetsAt ?? nextMonthResetAt(input.now).toISOString(),
    iapEnabled: input.iapEnabled,
  };
}

export type GradeQuotaConsumeSource = "monthly" | "credit";

export type GradeQuotaConsumeDecision =
  | { ok: true; source: GradeQuotaConsumeSource }
  | { ok: false };

/** Monthly allowance first, then extra credits. */
export function decideGradeConsume(input: {
  usedThisMonth: number;
  monthlyLimit: number;
  extraCredits: number;
}): GradeQuotaConsumeDecision {
  if (input.usedThisMonth < input.monthlyLimit) return { ok: true, source: "monthly" };
  if (input.extraCredits > 0) return { ok: true, source: "credit" };
  return { ok: false };
}

export function isOutOfGradesStatus(status: string | undefined): boolean {
  return status === "out_of_grades";
}
