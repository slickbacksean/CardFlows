/**
 * P1-07 async pre-grade jobs. Contract: `gradeJobRoutes`. OFF unless `CARD_FLOW_GRADE_JOBS=on`.
 * A job replays the request against the existing synchronous grade-estimate route in the
 * background (same auth, quota, cache and grader), so results are identical. A queue-full
 * 503 becomes "waiting" with the server's Retry-After, then retries (max 5).
 */
import { randomBytes } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { GRADE_ESTIMATE_UNAVAILABLE_COPY, type GradeJobView } from "@cardflow/shared";
import type { CardFlowApp } from "../app-env";
import { REQUEST_ID_HEADER } from "../request-id";

export interface GradeJobRouteDeps {
  enabled: boolean;
  /**
   * Runs the grade-estimate request in-process as `owner`. Backend review: the user's auth
   * headers are not copied onto the internal request; the app marks the Request object itself.
   */
  dispatch: (request: Request, owner: JobOwner) => Promise<Response>;
  /** Same body limit as grade-estimate (backend review). */
  bodyLimit?: MiddlewareHandler;
  /** Cap on stored jobs including finished ones; the oldest finished go first. */
  maxStoredJobs?: number;
  ttlMs?: number;
  maxWaits?: number;
  /** Max unfinished jobs across all users / per user. Over the cap → 503 + Retry-After. */
  maxActiveJobs?: number;
  maxActiveJobsPerUser?: number;
  /** TTL sweep interval. 0 disables the timer (prune still runs on every request). */
  sweepMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface JobOwner {
  userId: string;
  identity: unknown;
}

interface JobRecord extends GradeJobView {
  userId: string;
  createdAt: number;
}

/** Only the body type is forwarded. Auth travels in-process via `owner`, never as headers. */
const FORWARD_HEADERS = ["content-type"];

export interface GradeJobRoutes {
  /** Backend review L1: account deletion drops this user's jobs and any photo bytes still held. */
  purgeUser(userId: string): number;
}

export function registerGradeJobRoutes(app: CardFlowApp, deps: GradeJobRouteDeps): GradeJobRoutes {
  const jobs = new Map<string, JobRecord>();
  const heldBodies = new Map<string, { body: ArrayBuffer | null }>();
  const ttlMs = deps.ttlMs ?? 60 * 60_000;
  const maxWaits = deps.maxWaits ?? 5;
  const maxActive = deps.maxActiveJobs ?? 200;
  const maxPerUser = deps.maxActiveJobsPerUser ?? 5;
  const sweepMs = deps.sweepMs ?? 5 * 60_000;
  const maxStored = deps.maxStoredJobs ?? 1000;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const off = { ok: false, error: "Grade jobs are off" } as const;

  const isActive = (job: JobRecord) => job.status !== "done" && job.status !== "failed";

  const view = (job: JobRecord): GradeJobView => ({
    jobId: job.jobId,
    status: job.status,
    retryAfterSeconds: job.retryAfterSeconds,
    estimate: job.estimate,
    error: job.error,
    requestId: job.requestId,
  });

  function prune() {
    const cutoff = Date.now() - ttlMs;
    for (const [id, job] of jobs) if (job.createdAt < cutoff) jobs.delete(id);
    // Total cap including finished jobs: Map order is insertion order, so oldest finished go first.
    if (jobs.size >= maxStored) {
      for (const [id, job] of jobs) {
        if (jobs.size < maxStored) break;
        if (!isActive(job)) jobs.delete(id);
      }
    }
  }

  async function run(job: JobRecord, owner: JobOwner, url: string, headers: Headers, held: { body: ArrayBuffer | null }) {
    try {
      await runLoop(job, owner, url, headers, held);
    } finally {
      // Backend review: drop the photo bytes as soon as the job finishes.
      held.body = null;
    }
  }

  async function runLoop(job: JobRecord, owner: JobOwner, url: string, headers: Headers, held: { body: ArrayBuffer | null }) {
    for (let waits = 0; ; waits += 1) {
      job.status = "running";
      job.retryAfterSeconds = null;
      let res: Response;
      try {
        res = await deps.dispatch(new Request(url, { method: "POST", headers, body: held.body }), owner);
      } catch {
        job.status = "failed";
        job.error = GRADE_ESTIMATE_UNAVAILABLE_COPY;
        return;
      }
      // Queue full (503) or a short rate limit (429 with Retry-After ≤ 2 min) → wait, not fail.
      const retryHint = Number(res.headers.get("retry-after") ?? "NaN");
      const shortRateLimit = res.status === 429 && Number.isFinite(retryHint) && retryHint <= 120;
      if ((res.status === 503 || shortRateLimit) && waits < maxWaits) {
        const after = Number(res.headers.get("retry-after") ?? "5");
        job.status = "waiting";
        job.retryAfterSeconds = Number.isFinite(after) && after > 0 ? after : 5;
        await sleep(job.retryAfterSeconds * 1000);
        continue;
      }
      const data = (await res.json().catch(() => null)) as { estimate?: GradeJobView["estimate"]; error?: unknown } | null;
      if (res.ok && data?.estimate) {
        job.status = "done";
        job.estimate = data.estimate;
      } else {
        job.status = "failed";
        job.error = typeof data?.error === "string" ? data.error : GRADE_ESTIMATE_UNAVAILABLE_COPY;
        job.retryAfterSeconds = res.headers.get("retry-after") ? Number(res.headers.get("retry-after")) : null;
      }
      return;
    }
  }

  if (deps.enabled && sweepMs > 0) {
    const sweep = setInterval(prune, sweepMs);
    (sweep as { unref?: () => void }).unref?.();
  }

  const passThrough: MiddlewareHandler = async (_c, next) => next();
  const gate: MiddlewareHandler = async (c, next) => (deps.enabled ? next() : c.json(off, 404));

  app.post("/v1/inventory/:inventoryItemId/grade-jobs", gate, deps.bodyLimit ?? passThrough, async (c) => {
    prune();
    const userId = c.get("userId");
    const active = [...jobs.values()].filter(isActive);
    if (jobs.size >= maxStored || active.length >= maxActive || active.filter((j) => j.userId === userId).length >= maxPerUser) {
      c.header("Retry-After", "10");
      return c.json({ ok: false, error: "The pre-grade queue is full. Try again soon." }, 503);
    }
    // 256-bit random, URL-safe: unguessable even without the per-user check below.
    const jobId = randomBytes(32).toString("base64url");
    const job: JobRecord = {
      jobId,
      userId,
      createdAt: Date.now(),
      status: "queued",
      retryAfterSeconds: null,
      estimate: null,
      error: null,
      requestId: c.req.header(REQUEST_ID_HEADER) ?? null,
    };
    jobs.set(jobId, job);
    const headers = new Headers();
    for (const name of FORWARD_HEADERS) {
      const value = c.req.header(name);
      if (value) headers.set(name, value);
    }
    headers.set(REQUEST_ID_HEADER, job.requestId ?? jobId);
    const body = await c.req.arrayBuffer().catch(() => null);
    const url = new URL(c.req.url);
    url.pathname = `/v1/inventory/${encodeURIComponent(c.req.param("inventoryItemId"))}/grade-estimate`;
    const owner: JobOwner = { userId, identity: c.get("identity") };
    const held = { body: body && body.byteLength > 0 ? body : null };
    heldBodies.set(job.jobId, held);
    void run(job, owner, url.toString(), headers, held).finally(() => heldBodies.delete(job.jobId));
    return c.json({ ok: true, job: view(job) }, 202);
  });

  app.get("/v1/grade-jobs/:jobId", (c) => {
    if (!deps.enabled) return c.json(off, 404);
    prune();
    const job = jobs.get(c.req.param("jobId"));
    if (!job || job.userId !== c.get("userId")) return c.json({ ok: false, error: "Job not found" }, 404);
    return c.json({ ok: true, job: view(job) });
  });

  return {
    purgeUser(userId) {
      let n = 0;
      for (const [id, job] of jobs) {
        if (job.userId !== userId) continue;
        const held = heldBodies.get(id);
        if (held) held.body = null;
        heldBodies.delete(id);
        jobs.delete(id);
        n += 1;
      }
      return n;
    },
  };
}
