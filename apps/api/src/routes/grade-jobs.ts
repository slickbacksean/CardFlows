/**
 * P1-07 async pre-grade jobs. Contract: `gradeJobRoutes`. OFF unless `CARD_FLOW_GRADE_JOBS=on`.
 * A job replays the request against the existing synchronous grade-estimate route in the
 * background (same auth, quota, cache and grader), so results are identical. A queue-full
 * 503 becomes "waiting" with the server's Retry-After, then retries (max 5).
 */
import type { GradeJobView } from "@cardflow/shared";
import type { CardFlowApp } from "../app-env";
import { REQUEST_ID_HEADER } from "../request-id";

export interface GradeJobRouteDeps {
  enabled: boolean;
  dispatch: (request: Request) => Promise<Response>;
  ttlMs?: number;
  maxWaits?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface JobRecord extends GradeJobView {
  userId: string;
  createdAt: number;
}

const FORWARD_HEADERS = ["authorization", "content-type", "x-cardflow-app-key", "cookie"];

export function registerGradeJobRoutes(app: CardFlowApp, deps: GradeJobRouteDeps): void {
  const jobs = new Map<string, JobRecord>();
  const ttlMs = deps.ttlMs ?? 60 * 60_000;
  const maxWaits = deps.maxWaits ?? 5;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const off = { ok: false, error: "Grade jobs are off" } as const;

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
  }

  async function run(job: JobRecord, url: string, headers: Headers, body: ArrayBuffer | null) {
    for (let waits = 0; ; waits += 1) {
      job.status = "running";
      job.retryAfterSeconds = null;
      let res: Response;
      try {
        res = await deps.dispatch(new Request(url, { method: "POST", headers, body }));
      } catch {
        job.status = "failed";
        job.error = "Estimate unavailable.";
        return;
      }
      if (res.status === 503 && waits < maxWaits) {
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
        job.error = typeof data?.error === "string" ? data.error : "Estimate unavailable.";
        job.retryAfterSeconds = res.headers.get("retry-after") ? Number(res.headers.get("retry-after")) : null;
      }
      return;
    }
  }

  app.post("/v1/inventory/:inventoryItemId/grade-jobs", async (c) => {
    if (!deps.enabled) return c.json(off, 404);
    prune();
    const jobId = crypto.randomUUID();
    const job: JobRecord = {
      jobId,
      userId: c.get("userId"),
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
    void run(job, url.toString(), headers, body && body.byteLength > 0 ? body : null);
    return c.json({ ok: true, job: view(job) }, 202);
  });

  app.get("/v1/grade-jobs/:jobId", (c) => {
    if (!deps.enabled) return c.json(off, 404);
    const job = jobs.get(c.req.param("jobId"));
    if (!job || job.userId !== c.get("userId")) return c.json({ ok: false, error: "Job not found" }, 404);
    return c.json({ ok: true, job: view(job) });
  });
}
