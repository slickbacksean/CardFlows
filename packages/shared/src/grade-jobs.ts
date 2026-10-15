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

/** 1 s, 1.5 s, 2.25 s … capped at 8 s; a server wait hint wins when longer. */
export function gradeJobPollDelayMs(attempt: number, retryAfterSeconds?: number | null): number {
  const base = Math.min(GRADE_JOB_POLL_MAX_MS, Math.round(GRADE_JOB_POLL_START_MS * 1.5 ** Math.max(0, attempt)));
  const hint = retryAfterSeconds ? retryAfterSeconds * 1000 : 0;
  return Math.max(base, Math.min(hint, 60_000));
}

export function gradeJobWaitCopy(retryAfterSeconds: number | null): string {
  if (!retryAfterSeconds) return "Waiting for a pre-grade slot…";
  return `Busy right now. Your pre-grade estimate starts in about ${Math.max(1, Math.round(retryAfterSeconds))} s.`;
}

export function isGradeJobFinished(status: GradeJobStatus): boolean {
  return status === "done" || status === "failed";
}

/** Poll until done/failed or timeout. `sleep` and `now` are injectable for tests. */
export async function pollGradeJob(
  get: () => Promise<GradeJobView>,
  options: {
    onUpdate?: (job: GradeJobView) => void;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    timeoutMs?: number;
  } = {},
): Promise<GradeJobView | null> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());
  const deadline = now() + (options.timeoutMs ?? GRADE_JOB_POLL_TIMEOUT_MS);
  for (let attempt = 0; now() < deadline; attempt += 1) {
    let job: GradeJobView | null = null;
    try {
      job = await get();
    } catch {
      job = null; // network blip: keep polling, the job lives on the server
    }
    if (job) {
      options.onUpdate?.(job);
      if (isGradeJobFinished(job.status)) return job;
    }
    await sleep(gradeJobPollDelayMs(attempt, job?.retryAfterSeconds));
  }
  return null;
}
