/**
 * Sean (Oct 18): every monthly allowance (quick estimates and full grades) resets on the 1st of
 * each calendar month, 00:00 UTC (the server has no user time zone), for everyone. Exception: an
 * account with a billing date (Apple subscription, not wired yet) keeps resetting on that date so
 * the Premium allowance lines up with what Apple bills. Unused estimates don't roll over.
 * Bought credits never expire (Sean, Oct 16).
 */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** `anchor` moved by `months`, clamping the day (Jan 31 → Feb 28/29). Keeps the anchor's time of day. */
export function addMonthsClamped(anchor: Date, months: number): Date {
  const total = anchor.getUTCMonth() + months;
  const year = anchor.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const day = Math.min(anchor.getUTCDate(), daysInMonth(year, month));
  return new Date(
    Date.UTC(year, month, day, anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds()),
  );
}

export interface QuotaPeriod {
  /** Stable key for usage rows: the period start date `YYYY-MM-DD` (UTC). */
  key: string;
  startsAt: string;
  resetsAt: string;
}

/** The allowance period containing `now` for an account anchored at `anchorIso`. */
export function quotaPeriodFor(anchorIso: string, now: Date): QuotaPeriod {
  const parsed = Date.parse(anchorIso);
  const anchor = Number.isFinite(parsed) ? new Date(parsed) : now;
  if (anchor.getTime() > now.getTime()) {
    return { key: anchor.toISOString().slice(0, 10), startsAt: anchor.toISOString(), resetsAt: addMonthsClamped(anchor, 1).toISOString() };
  }
  let months = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  let start = addMonthsClamped(anchor, months);
  if (start.getTime() > now.getTime()) {
    months -= 1;
    start = addMonthsClamped(anchor, months);
  }
  const next = addMonthsClamped(anchor, months + 1);
  return { key: start.toISOString().slice(0, 10), startsAt: start.toISOString(), resetsAt: next.toISOString() };
}

/** Any 1st-of-month 00:00 UTC: anchoring here makes quotaPeriodFor return calendar months. */
export const CALENDAR_MONTH_ANCHOR = "2000-01-01T00:00:00.000Z";

/** Billing date wins (Apple); otherwise the calendar month. `createdAt` no longer moves the reset. */
export function quotaAnchor(input: { billingAnchorAt?: string | null; createdAt?: string }): string {
  return input.billingAnchorAt || CALENDAR_MONTH_ANCHOR;
}

/**
 * Policy Reviewer: the reset date is shown in the user's local time zone (the phone's zone by
 * default), so a reset at 00:30 UTC on the 16th reads "Resets Oct 15" in Los Angeles.
 * `timeZone` is for tests and server-side callers that know the user's zone.
 */
export function resetDateLabel(resetsAt: string, options: { timeZone?: string } = {}): string {
  const d = new Date(resetsAt);
  if (!Number.isFinite(d.getTime())) return "";
  const format: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (options.timeZone) format.timeZone = options.timeZone;
  // A calendar-month reset (1st, 00:00 UTC) reads "Resets Nov 1" everywhere, not "Oct 31" in LA.
  else if (d.getUTCDate() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0) format.timeZone = "UTC";
  return `Resets ${d.toLocaleDateString("en-US", format)}`;
}
