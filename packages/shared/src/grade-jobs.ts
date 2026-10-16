/** P1-07: async pre-grade jobs. POST returns a job ID; the phone polls with backoff. */
import type { CardFlowGradeEstimate } from "./grade-estimate";

export type GradeJobStatus = "queued" | "running" | "waiting" | "done" | "failed";

export interface GradeJobView {
  jobId: string;
  status: GradeJobStatus;
  /** Set while waiting for a grader slot (queue full). */
  retryAfterSeconds: number | null;
  estimate: CardFlowGradeEstimate | null;
  error: string | null;
  requestId: string | null;
}

export const GRADE_JOB_POLL_START_MS = 1_000;
export const GRADE_JOB_POLL_MAX_MS = 8_000;
export const GRADE_JOB_POLL_TIMEOUT_MS = 5 * 60_000;
/** Consecutive failed polls before the wait card shows the offline row. */
export const GRADE_JOB_OFFLINE_AFTER_FAILURES = 2;

export const GRADE_WAIT_COPY = {
  estimating: "Estimating your card…",
  estimatingSub: "This usually takes a few seconds.",
  waitingUnknown: "Waiting for a pre-grade slot…",
  startingSoon: "Starting soon…",
  stillBusy: "Still busy. We'll keep trying.",
  offline: "You're offline. We'll pick up where you left off.",
  errorTitle: "We couldn't finish the estimate",
  errorBody: "Your photos are saved. Try again in a moment.",
  cancel: "Cancel",
  cancelA11y: "Cancel estimate. Your photos are kept.",
} as const;

/** 1 s, 1.5 s, 2.25 s … capped at 8 s; a server wait hint wins when longer. */
export function gradeJobPollDelayMs(attempt: number, retryAfterSeconds?: number | null): number {
  const base = Math.min(GRADE_JOB_POLL_MAX_MS, Math.round(GRADE_JOB_POLL_START_MS * 1.5 ** Math.max(0, attempt)));
  const hint = retryAfterSeconds ? retryAfterSeconds * 1000 : 0;
  return Math.max(base, Math.min(hint, 60_000));
}

/**
 * Policy-approved wait copy. ≤ 60: "about N seconds"; over 60: "about N min" (rounded up);
 * 0 or less: "Starting soon…" (never "0 s"); unknown: "Waiting for a pre-grade slot…".
 */
export function gradeJobWaitCopy(secondsLeft: number | null): string {
  if (secondsLeft === null || !Number.isFinite(secondsLeft)) return GRADE_WAIT_COPY.waitingUnknown;
  const n = Math.ceil(secondsLeft);
  if (n <= 0) return GRADE_WAIT_COPY.startingSoon;
  if (n <= 60) return `Busy right now. Your pre-grade estimate starts in about ${n} ${n === 1 ? "second" : "seconds"}.`;
  return `Busy right now. Your pre-grade estimate starts in about ${Math.ceil(n / 60)} min.`;
}

/** Screen-reader form: units spelled out ("minutes", not "min"). */
export function gradeJobWaitAnnouncement(secondsLeft: number | null): string {
  const n = secondsLeft === null ? null : Math.ceil(secondsLeft);
  if (n !== null && n > 60) {
    const m = Math.ceil(n / 60);
    return `Busy right now. Your pre-grade estimate starts in about ${m} ${m === 1 ? "minute" : "minutes"}.`;
  }
  return gradeJobWaitCopy(n);
}

export function isGradeJobFinished(status: GradeJobStatus): boolean {
  return status === "done" || status === "failed";
}

export type GradeJobPollResult =
  | { kind: "finished"; job: GradeJobView }
  | { kind: "timeout" }
  | { kind: "not_found" }
  | { kind: "aborted" };

/**
 * Poll until done/failed, timeout, 404 (job expired or server restarted → caller retries the
 * grade), or abort (Cancel). Network errors keep polling and are reported via `onPollError`.
 */
export async function pollGradeJob(
  get: () => Promise<GradeJobView>,
  options: {
    onUpdate?: (job: GradeJobView) => void;
    onPollError?: (consecutiveFailures: number) => void;
    isNotFound?: (error: unknown) => boolean;
    signal?: AbortSignal;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    now?: () => number;
    timeoutMs?: number;
  } = {},
): Promise<GradeJobPollResult> {
  const sleep =
    options.sleep ??
    ((ms: number, signal?: AbortSignal) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          resolve();
        });
      }));
  const now = options.now ?? (() => Date.now());
  const deadline = now() + (options.timeoutMs ?? GRADE_JOB_POLL_TIMEOUT_MS);
  let failures = 0;
  for (let attempt = 0; now() < deadline; attempt += 1) {
    if (options.signal?.aborted) return { kind: "aborted" };
    let job: GradeJobView | null = null;
    try {
      job = await get();
      failures = 0;
    } catch (error) {
      if (options.isNotFound?.(error)) return { kind: "not_found" };
      failures += 1;
      options.onPollError?.(failures);
    }
    if (options.signal?.aborted) return { kind: "aborted" };
    if (job) {
      options.onUpdate?.(job);
      if (isGradeJobFinished(job.status)) return { kind: "finished", job };
    }
    await sleep(gradeJobPollDelayMs(attempt, job?.retryAfterSeconds), options.signal);
  }
  return { kind: "timeout" };
}

/** Retryable failure from the job path (timeout, failed job, lost job twice). Never a silent "unavailable". */
export class GradeJobError extends Error {
  readonly retryable = true;
  constructor(
    readonly reason: "timeout" | "failed" | "not_found",
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(GRADE_WAIT_COPY.errorTitle);
    this.name = "GradeJobError";
  }
}

export class GradeJobCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "GradeJobCancelled";
  }
}

/** Wait-card clock, updated only from job/poll callbacks (pure, testable). */
export interface GradeWaitClock {
  job: GradeJobView | null;
  /** Epoch ms the current wait ends; null when not waiting or no hint. */
  deadline: number | null;
  failures: number;
  /** Seconds shown while offline (frozen), else null. */
  frozenSeconds: number | null;
}

export const EMPTY_GRADE_WAIT_CLOCK: GradeWaitClock = { job: null, deadline: null, failures: 0, frozenSeconds: null };

export function waitClockOnJob(clock: GradeWaitClock, job: GradeJobView, now: number): GradeWaitClock {
  if (job.status !== "waiting" || !job.retryAfterSeconds) {
    return { job, deadline: null, failures: 0, frozenSeconds: null };
  }
  const next = now + job.retryAfterSeconds * 1000;
  // Only a clearly later deadline starts a new wait; otherwise N keeps counting down.
  const deadline = clock.deadline !== null && next <= clock.deadline + 1500 ? clock.deadline : next;
  return { job, deadline, failures: 0, frozenSeconds: null };
}

export function waitClockOnPollError(clock: GradeWaitClock, failures: number, now: number): GradeWaitClock {
  const frozenSeconds =
    failures >= GRADE_JOB_OFFLINE_AFTER_FAILURES && clock.deadline !== null
      ? clock.frozenSeconds ?? waitSecondsLeft(clock.deadline, now)
      : clock.frozenSeconds;
  return { ...clock, failures, frozenSeconds };
}

export function waitSecondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
