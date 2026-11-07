/**
 * P1-07 async pre-grade jobs. Contract: `gradeJobRoutes`. OFF unless `CARD_FLOW_GRADE_JOBS=on`.
 * A job replays the request against the existing synchronous grade-estimate route in the
 * background (same auth, quota, cache and grader), so results are identical. A queue-full
 * 503 becomes "waiting" with the server's Retry-After, then retries (max 5).
 *
 * Job rows and request bodies are persisted (SQLite + grade/jobs/*.bin) so a Railway
 * redeploy can resume unfinished work instead of 404ing the poll.
 */
import { randomBytes } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { GRADE_ESTIMATE_UNAVAILABLE_COPY, type GradeJobView } from "@cardflow/shared";
import type { CardFlowApp } from "../app-env";
import { REQUEST_ID_HEADER } from "../request-id";
import type { GradeJobStore, PersistedGradeJob } from "../process-state-store";

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
  /** Survives Railway redeploys. Memory store for tests that don't care. */
  jobs?: GradeJobStore;
}

export interface JobOwner {
  userId: string;
  identity: unknown;
}

interface JobRecord extends GradeJobView {
  userId: string;
  createdAt: number;
  inventoryItemId: string;
  url: string;
  contentType: string | null;
  identityJson: string;
}

/** Only the body type is forwarded. Auth travels in-process via `owner`, never as headers. */
const FORWARD_HEADERS = ["content-type"];

export interface GradeJobRoutes {
  /** Backend review L1: account deletion drops this user's jobs and any photo bytes still held. */
  purgeUser(userId: string): number;
  /** Resume unfinished jobs after all routes are registered (createApp calls this last). */
  resumeUnfinished(): void;
}

function toPersisted(job: JobRecord): PersistedGradeJob {
  return {
    jobId: job.jobId,
    userId: job.userId,
    createdAt: job.createdAt,
    status: job.status,
    retryAfterSeconds: job.retryAfterSeconds,
    estimate: job.estimate,
    error: job.error,
    requestId: job.requestId,
    inventoryItemId: job.inventoryItemId,
    contentType: job.contentType,
    url: job.url,
    identityJson: job.identityJson,
  };
}

function fromPersisted(row: PersistedGradeJob): JobRecord {
  return {
    jobId: row.jobId,
    userId: row.userId,
    createdAt: row.createdAt,
    status: row.status,
    retryAfterSeconds: row.retryAfterSeconds,
    estimate: row.estimate,
    error: row.error,
    requestId: row.requestId,
    inventoryItemId: row.inventoryItemId,
    url: row.url,
    contentType: row.contentType,
    identityJson: row.identityJson,
  };
}

export function registerGradeJobRoutes(app: CardFlowApp, deps: GradeJobRouteDeps): GradeJobRoutes {
  const jobs = new Map<string, JobRecord>();
  const heldBodies = new Map<string, { body: ArrayBuffer | null }>();
  const persist = deps.jobs;
  const ttlMs = deps.ttlMs ?? 60 * 60_000;
  const maxWaits = deps.maxWaits ?? 5;
  const maxActive = deps.maxActiveJobs ?? 200;
  const maxPerUser = deps.maxActiveJobsPerUser ?? 5;
  const sweepMs = deps.sweepMs ?? 5 * 60_000;
  const maxStored = deps.maxStoredJobs ?? 1000;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const off = { ok: false, error: "Grade jobs are off" } as const;

  if (persist) {
    for (const row of persist.list()) jobs.set(row.jobId, fromPersisted(row));
  }

  const isActive = (job: JobRecord) => job.status !== "done" && job.status !== "failed";

  const view = (job: JobRecord): GradeJobView => ({
    jobId: job.jobId,
    status: job.status,
    retryAfterSeconds: job.retryAfterSeconds,
    estimate: job.estimate,
    error: job.error,
    requestId: job.requestId,
  });

  function persistJob(job: JobRecord) {
    persist?.save(toPersisted(job));
  }

  function dropJob(jobId: string) {
    jobs.delete(jobId);
    const held = heldBodies.get(jobId);
    if (held) held.body = null;
    heldBodies.delete(jobId);
    persist?.delete(jobId);
  }

  function prune() {
    const cutoff = Date.now() - ttlMs;
    for (const [id, job] of jobs) if (job.createdAt < cutoff) dropJob(id);
    persist?.prune(cutoff, maxStored);
    if (persist) {
      const live = persist.list();
      const keep = new Set(live.map((row) => row.jobId));
      for (const id of [...jobs.keys()]) {
        if (keep.has(id)) continue;
        jobs.delete(id);
        heldBodies.delete(id);
      }
      for (const row of live) if (!jobs.has(row.jobId)) jobs.set(row.jobId, fromPersisted(row));
    } else if (jobs.size >= maxStored) {
      for (const [id, job] of jobs) {
        if (jobs.size < maxStored) break;
        if (!isActive(job)) dropJob(id);
      }
    }
  }

  async function run(job: JobRecord, owner: JobOwner, url: string, headers: Headers, held: { body: ArrayBuffer | null }) {
    try {
      await runLoop(job, owner, url, headers, held);
    } finally {
      held.body = null;
      persist?.deleteBody(job.jobId);
      heldBodies.delete(job.jobId);
    }
  }

  async function runLoop(job: JobRecord, owner: JobOwner, url: string, headers: Headers, held: { body: ArrayBuffer | null }) {
    for (let waits = 0; ; waits += 1) {
      job.status = "running";
      job.retryAfterSeconds = null;
      persistJob(job);
      let res: Response;
      try {
        res = await deps.dispatch(new Request(url, { method: "POST", headers, body: held.body }), owner);
      } catch {
        job.status = "failed";
        job.error = GRADE_ESTIMATE_UNAVAILABLE_COPY;
        persistJob(job);
        return;
      }
      const retryHint = Number(res.headers.get("retry-after") ?? "NaN");
      const shortRateLimit = res.status === 429 && Number.isFinite(retryHint) && retryHint <= 120;
      if ((res.status === 503 || shortRateLimit) && waits < maxWaits) {
        const after = Number(res.headers.get("retry-after") ?? "5");
        job.status = "waiting";
        job.retryAfterSeconds = Number.isFinite(after) && after > 0 ? after : 5;
        persistJob(job);
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
      persistJob(job);
      return;
    }
  }

  function startJob(job: JobRecord, owner: JobOwner, url: string, headers: Headers, held: { body: ArrayBuffer | null }) {
    heldBodies.set(job.jobId, held);
    void run(job, owner, url, headers, held);
  }

  function resumeUnfinished() {
    if (!deps.enabled || !persist) return;
    prune();
    for (const job of jobs.values()) {
      if (!isActive(job) || heldBodies.has(job.jobId)) continue;
      const body = persist.readBody(job.jobId);
      if (!body) {
        job.status = "failed";
        job.error = GRADE_ESTIMATE_UNAVAILABLE_COPY;
        persistJob(job);
        continue;
      }
      let identity: unknown = { userId: job.userId };
      try {
        identity = JSON.parse(job.identityJson) as unknown;
      } catch {
        identity = { userId: job.userId };
      }
      const headers = new Headers();
      if (job.contentType) headers.set("content-type", job.contentType);
      headers.set(REQUEST_ID_HEADER, job.requestId ?? job.jobId);
      startJob(job, { userId: job.userId, identity }, job.url, headers, { body });
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
    const jobId = randomBytes(32).toString("base64url");
    const inventoryItemId = c.req.param("inventoryItemId");
    const url = new URL(c.req.url);
    url.pathname = `/v1/inventory/${encodeURIComponent(inventoryItemId)}/grade-estimate`;
    const contentType = c.req.header("content-type") ?? null;
    const identity = c.get("identity");
    const job: JobRecord = {
      jobId,
      userId,
      createdAt: Date.now(),
      status: "queued",
      retryAfterSeconds: null,
      estimate: null,
      error: null,
      requestId: c.req.header(REQUEST_ID_HEADER) ?? null,
      inventoryItemId,
      url: url.toString(),
      contentType,
      identityJson: JSON.stringify(identity ?? { userId }),
    };
    jobs.set(jobId, job);
    persistJob(job);
    const headers = new Headers();
    for (const name of FORWARD_HEADERS) {
      const value = c.req.header(name);
      if (value) headers.set(name, value);
    }
    headers.set(REQUEST_ID_HEADER, job.requestId ?? jobId);
    const body = await c.req.arrayBuffer().catch(() => null);
    const owner: JobOwner = { userId, identity };
    const held = { body: body && body.byteLength > 0 ? body : null };
    if (held.body) persist?.saveBody(job.jobId, held.body);
    startJob(job, owner, url.toString(), headers, held);
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
      if (persist) {
        const n = persist.deleteUser(userId);
        for (const [id, job] of jobs) {
          if (job.userId !== userId) continue;
          const held = heldBodies.get(id);
          if (held) held.body = null;
          heldBodies.delete(id);
          jobs.delete(id);
        }
        return n;
      }
      let n = 0;
      for (const [id, job] of jobs) {
        if (job.userId !== userId) continue;
        dropJob(id);
        n += 1;
      }
      return n;
    },
    resumeUnfinished,
  };
}
