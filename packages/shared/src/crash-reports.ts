/**
 * Policy Reviewer (P4): Settings > "Send crash reports". Off by default (opt-in).
 * It gates initMobileSentry, and turning it off stops sending right away (the client
 * is closed and beforeSend drops anything still queued). Crash reports stay
 * independent of the analytics opt-in (docs/SENTRY.md).
 */
export const CRASH_REPORTS_DEFAULT_ON = false;
export const CRASH_REPORTS_STORE_KEY = "cardflow.crash_reports";

export const CRASH_REPORTS_COPY = {
  label: "Send crash reports",
  note: "When the app crashes, send an error report to Sentry, our crash-report provider, so we can fix it. Photos, your email and passwords are removed first. Off by default.",
} as const;

/** Stored value → on/off. Nothing stored means the default. */
export function crashReportsEnabledFrom(stored: string | null | undefined): boolean {
  if (stored === "1") return true;
  if (stored === "0") return false;
  return CRASH_REPORTS_DEFAULT_ON;
}
