/**
 * Livestream scanner access: free for 3 days from first use, then Premium.
 * v1 hides in-app purchases, so after the trial the app shows a locked
 * "coming soon" message (no purchase button). Frames stay in-house
 * (OpenCLIP/pHash) and never go to CardSight — no CardSight consent check.
 */
export const LIVESTREAM_TRIAL_DAYS = 3;

export const LIVESTREAM_TRIAL_MS = LIVESTREAM_TRIAL_DAYS * 86_400_000;

export type LivestreamAccessState = "ready" | "trial" | "locked" | "premium";

export interface LivestreamAccess {
  state: LivestreamAccessState;
  trialDays: number;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  /** Whole days remaining (ceil). 0 when locked or expired. Before first use, equals trialDays. */
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
  trialStartedAt: string | null;
  now: Date;
}): LivestreamAccess {
  const trialDays = LIVESTREAM_TRIAL_DAYS;
  if (input.premium) {
    return {
      state: "premium",
      trialDays,
      trialStartedAt: input.trialStartedAt,
      trialEndsAt: input.trialStartedAt ? livestreamTrialEndsAt(input.trialStartedAt) : null,
      daysLeft: input.trialStartedAt ? livestreamTrialDaysLeft(input.trialStartedAt, input.now) : trialDays,
    };
  }
  if (!input.trialStartedAt) {
    return {
      state: "ready",
      trialDays,
      trialStartedAt: null,
      trialEndsAt: null,
      daysLeft: trialDays,
    };
  }
  const daysLeft = livestreamTrialDaysLeft(input.trialStartedAt, input.now);
  const trialEndsAt = livestreamTrialEndsAt(input.trialStartedAt);
  if (daysLeft > 0) {
    return {
      state: "trial",
      trialDays,
      trialStartedAt: input.trialStartedAt,
      trialEndsAt,
      daysLeft,
    };
  }
  return {
    state: "locked",
    trialDays,
    trialStartedAt: input.trialStartedAt,
    trialEndsAt,
    daysLeft: 0,
  };
}

/** True when identify / guesses may run (premium, trial not started, or trial still open). */
export function livestreamAccessAllowed(access: LivestreamAccess): boolean {
  return access.state === "premium" || access.state === "ready" || access.state === "trial";
}
