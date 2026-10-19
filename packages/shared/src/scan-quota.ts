/**
 * Monthly card-scan (identify → confirm) allowance.
 * Sean (Oct 18): free 30 confirmed cards a month, Premium unlimited.
 * Charged per confirmed card (not per photo). Non-English skips and rejects
 * do not count. There was no prior scan-quota module; this matches grade-quota
 * shape. Flag for Sean if per-photo is preferred instead.
 */
import {
  GRADE_PLAN_FREE,
  GRADE_PLAN_PREMIUM,
  GRADE_QUOTA_UNLIMITED_LIMIT,
  calendarMonthKey,
  nextMonthResetAt,
  type GradePlan,
} from "./grade-quota";
import { resetDateLabel } from "./quota-period";

export const SCAN_QUOTA_FREE_PER_MONTH = 30;
export const SCAN_QUOTA_PREMIUM_UNLIMITED = true;

export const SCAN_QUOTA_COPY = {
  remainingOne: "1 card scan left this month",
  unlimited: "Unlimited card scans",
  outOfScans: "You're out of free card scans this month.",
  outOfScansHint:
    "Your monthly allowance resets on your reset date. Unused scans don't roll over.",
  englishOnly: "Only English cards are supported for now.",
} as const;

export interface ScanQuotaSnapshot {
  plan: GradePlan;
  month: string;
  monthlyLimit: number;
  usedThisMonth: number;
  remainingScans: number;
  resetsAt: string;
  unlimited?: boolean;
}

export function scanMonthlyLimitForPlan(plan: GradePlan): number {
  return plan === GRADE_PLAN_PREMIUM ? GRADE_QUOTA_UNLIMITED_LIMIT : SCAN_QUOTA_FREE_PER_MONTH;
}

export function scanQuotaSnapshot(input: {
  plan: GradePlan;
  usedThisMonth: number;
  now: Date;
  period?: { key: string; resetsAt: string };
}): ScanQuotaSnapshot {
  const unlimited = input.plan === GRADE_PLAN_PREMIUM && SCAN_QUOTA_PREMIUM_UNLIMITED;
  const monthlyLimit = scanMonthlyLimitForPlan(input.plan);
  const used = Math.max(0, Math.floor(input.usedThisMonth));
  const remaining = unlimited ? monthlyLimit : Math.max(0, monthlyLimit - used);
  const month = input.period?.key ?? calendarMonthKey(input.now);
  const resetsAt = input.period?.resetsAt ?? nextMonthResetAt(input.now).toISOString();
  return {
    plan: input.plan,
    month,
    monthlyLimit,
    usedThisMonth: used,
    remainingScans: remaining,
    resetsAt,
    ...(unlimited ? { unlimited: true } : {}),
  };
}

export function remainingScansCaption(snap: ScanQuotaSnapshot): string {
  if (snap.unlimited) return SCAN_QUOTA_COPY.unlimited;
  const reset = resetDateLabel(snap.resetsAt);
  if (snap.remainingScans <= 0) {
    return reset ? `${SCAN_QUOTA_COPY.outOfScans} ${reset}.` : SCAN_QUOTA_COPY.outOfScans;
  }
  const n = snap.remainingScans;
  const left = n === 1 ? SCAN_QUOTA_COPY.remainingOne : `${n} card scans left this month`;
  return reset ? `${left}. ${reset}.` : left;
}

export { GRADE_PLAN_FREE, GRADE_PLAN_PREMIUM, calendarMonthKey };
