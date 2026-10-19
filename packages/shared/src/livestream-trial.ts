/**
 * Livestream scanner access: free for 3 days from account creation, then Premium.
 * v1 hides in-app purchases, so after the trial the app shows a locked
 * "coming soon" message (no purchase button). Frames stay in-house
 * (OpenCLIP/pHash) and never go to CardSight — no CardSight consent check.
 *
 * Sean (Oct 19): the trial clock starts when the user creates their account
 * (`user_accounts.created_at`), not on first scanner use.
 */
export const LIVESTREAM_TRIAL_DAYS = 3;

export const LIVESTREAM_TRIAL_MS = LIVESTREAM_TRIAL_DAYS * 86_400_000;

export type LivestreamAccessState = "trial" | "locked" | "premium";

export interface LivestreamAccess {
  state: LivestreamAccessState;
  trialDays: number;
  /** Account creation time (ISO). Same as the trial start. */
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  /** Whole days remaining (ceil). 0 when locked or expired. */
  daysLeft: number;
}

export function livestreamTrialEndsAt(startedAt: string): string {
  return new Date(Date.parse(startedAt) + LIVESTREAM_TRIAL_MS).toISOString();
}

/** Whole days remaining (ceil). 0 when the trial has ended. */
export function livestreamTrialDaysLeft(startedAt: string, now: Date): number {
  const ends = Date.parse(startedAt) + LIVESTREAM_TRIAL_MS;
  const ms = ends - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

export function livestreamAccessFor(input: {
  premium: boolean;
  /** Account creation time. Required for free users; trial window is createdAt + 3 days. */
  accountCreatedAt: string | null;
  now: Date;
}): LivestreamAccess {
  const trialDays = LIVESTREAM_TRIAL_DAYS;
  const trialStartedAt = input.accountCreatedAt;
  if (input.premium) {
    return {
      state: "premium",
      trialDays,
      trialStartedAt,
      trialEndsAt: trialStartedAt ? livestreamTrialEndsAt(trialStartedAt) : null,
      daysLeft: trialStartedAt ? livestreamTrialDaysLeft(trialStartedAt, input.now) : trialDays,
    };
  }
  if (!trialStartedAt) {
    // No account creation time (should not happen for signed-in open sign-up). Treat as locked.
    return {
      state: "locked",
      trialDays,
      trialStartedAt: null,
      trialEndsAt: null,
      daysLeft: 0,
    };
  }
  const daysLeft = livestreamTrialDaysLeft(trialStartedAt, input.now);
  const trialEndsAt = livestreamTrialEndsAt(trialStartedAt);
  if (daysLeft > 0) {
    return {
      state: "trial",
      trialDays,
      trialStartedAt,
      trialEndsAt,
      daysLeft,
    };
  }
  return {
    state: "locked",
    trialDays,
    trialStartedAt,
    trialEndsAt,
    daysLeft: 0,
  };
}

/** True when identify / guesses may run (premium or trial still open). */
export function livestreamAccessAllowed(access: LivestreamAccess): boolean {
  return access.state === "premium" || access.state === "trial";
}
