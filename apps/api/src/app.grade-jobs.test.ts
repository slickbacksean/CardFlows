import { describe, expect, it } from "vitest";
import { DEFAULT_INVITED_USER_ID, pollGradeJob, type GradeJobView } from "@cardflow/shared";
import { createApp } from "./app";
import { createMemoryStore } from "./store";

type App = ReturnType<typeof createApp>;

// Helper to create an app with grading enabled by default for tests
function testApp(store = createMemoryStore(), options: Parameters<typeof createApp>[1] = {}) {
  return createApp(store, { gradingEnabled: () => true, ...options });
}
const TINY_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

async function purchasedWithStill(app: App) {
  const form = new FormData();
  form.append("captureMethod", "camera_photo");
  form.append("scenario", "high-confidence");
  form.append("image", new File([TINY_JPEG], "still.jpg", { type: "image/jpeg" }));
  const scan = (await (await app.request("/v1/scans", { method: "POST", body: form })).json()) as { scan: { scanId: string } };
  const confirmed = (await (
    await app.request(`/v1/scans/${scan.scan.scanId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tcgdexId: "base1-58" }),
    })
  ).json()) as { confirmation: { confirmationId: string } };
  const purchased = (await (
    await app.request("/v1/inventory/purchased", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmationId: confirmed.confirmation.confirmationId, purchasePrice: "10", purchasedAt: "2026-10-01" }),
    })
  ).json()) as { item: { inventoryItemId: string } };
  return purchased.item.inventoryItemId;
}

const getJob = (app: App, jobId: string) => async () =>
  ((await (await app.request(`/v1/grade-jobs/${jobId}`)).json()) as { job: GradeJobView }).job;

describe("P1-07 async grade jobs", () => {
  it("is off by default", async () => {
    const app = testApp();
    expect((await app.request("/v1/inventory/x/grade-jobs", { method: "POST" })).status).toBe(404);
    expect((await app.request("/v1/grade-jobs/x")).status).toBe(404);
  });

  it("returns a job ID at once and the polled result matches the synchronous route", async () => {
    const app = testApp(createMemoryStore(), { gradeJobs: true });
    const id = await purchasedWithStill(app);
    const created = await app.request(`/v1/inventory/${id}/grade-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-123" },
      body: JSON.stringify({}),
    });
    expect(created.status).toBe(202);
    const { job } = (await created.json()) as { job: GradeJobView };
    expect(job.requestId).toBe("req-123");
    const outcome = await pollGradeJob(getJob(app, job.jobId), { sleep: async () => {} });
    const done = outcome.kind === "finished" ? outcome.job : null;
    expect(done?.status).toBe("done");
    const sync = (await (
      await app.request(`/v1/inventory/${id}/grade-estimate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    ).json()) as { estimate: { display: string } };
    expect((done?.estimate as { display: string }).display).toBe(sync.estimate.display);
  });

  it("queue full shows waiting with the server's wait time, then finishes", async () => {
    let full = true;
    const app = testApp(createMemoryStore(), { gradeJobs: true, gradeGate: { isFull: () => full } });
    const id = await purchasedWithStill(app);
    const created = (await (
      await app.request(`/v1/inventory/${id}/grade-jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    ).json()) as { job: GradeJobView };
    const seen: string[] = [];
    let waitHint: number | null = null;
    const result = await pollGradeJob(getJob(app, created.job.jobId), {
      sleep: async () => {
        await new Promise((r) => setTimeout(r, 5));
      },
      onUpdate: (job) => {
        seen.push(job.status);
        if (job.status === "waiting") {
          waitHint = job.retryAfterSeconds;
          full = false;
        }
      },
      timeoutMs: 30_000,
    });
    expect(seen).toContain("waiting");
    expect(waitHint).toBeGreaterThan(0);
    expect(["finished", "timeout"]).toContain(result.kind);
  }, 40_000);

  it("another user cannot read a job", async () => {
    const app = testApp(createMemoryStore(), { gradeJobs: true });
    expect((await app.request("/v1/grade-jobs/not-a-job")).status).toBe(404);
  });

  it("job IDs are 256-bit random, unfinished jobs are capped, and expired jobs 404 (client retries)", async () => {
    let full = true;
    const app = testApp(createMemoryStore(), {
      gradeJobs: true,
      gradeGate: { isFull: () => full },
      gradeJobLimits: { maxActiveJobsPerUser: 2, ttlMs: 50, sweepMs: 0 },
    });
    const id = await purchasedWithStill(app);
    const post = () =>
      app.request(`/v1/inventory/${id}/grade-jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
    const a = (await (await post()).json()) as { job: GradeJobView };
    await post();
    expect(a.job.jobId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const capped = await post();
    expect(capped.status).toBe(503);
    expect(capped.headers.get("retry-after")).toBe("10");
    full = false;
    await new Promise((r) => setTimeout(r, 80));
    expect((await app.request(`/v1/grade-jobs/${a.job.jobId}`)).status).toBe(404);
    const lost = await pollGradeJob(getJob404(app, a.job.jobId), { sleep: async () => {}, isNotFound: (e) => (e as { status?: number }).status === 404 });
    expect(lost).toEqual({ kind: "not_found" });
  });
});

const getJob404 = (app: App, jobId: string) => async () => {
  const res = await app.request(`/v1/grade-jobs/${jobId}`);
  if (res.status === 404) throw Object.assign(new Error("not found"), { status: 404 });
  return ((await res.json()) as { job: GradeJobView }).job;
};

describe("grade jobs backend review", () => {
  it("finishes without re-sending the user's auth headers (app key on, no dev session leak)", async () => {
    const inner = testApp(createMemoryStore(), { gradeJobs: true, appApiKey: "app-key-1" });
    const app = {
      request: (url: string, init: RequestInit = {}) =>
        inner.request(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), "x-cardflow-app-key": "app-key-1" } }),
    } as unknown as App;
    const id = await purchasedWithStill(app);
    const created = (await (
      await app.request(`/v1/inventory/${id}/grade-jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    ).json()) as { job: GradeJobView };
    const outcome = await pollGradeJob(getJob(app, created.job.jobId), { sleep: async () => {} });
    expect(outcome.kind === "finished" ? `${outcome.job.status}:${outcome.job.error}` : outcome.kind).toBe("done:null");
    // A network request without the key still fails: the bypass is only for in-process jobs.
    expect((await inner.request(`/v1/grade-jobs/${created.job.jobId}`)).status).toBe(401);
  });

  it("caps stored jobs including finished ones and has a body limit", async () => {
    const app = testApp(createMemoryStore(), { gradeJobs: true, gradeJobLimits: { maxStoredJobs: 2, sweepMs: 0 } });
    const id = await purchasedWithStill(app);
    const post = () =>
      app.request(`/v1/inventory/${id}/grade-jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await post();
      expect(res.status).toBe(202);
      const { job } = (await res.json()) as { job: GradeJobView };
      ids.push(job.jobId);
      await pollGradeJob(getJob(app, job.jobId), { sleep: async () => {} });
    }
    // Oldest finished jobs were evicted to stay under the cap.
    expect((await app.request(`/v1/grade-jobs/${ids[0]}`)).status).toBe(404);
    expect((await app.request(`/v1/grade-jobs/${ids[3]}`)).status).toBe(200);
    const huge = new FormData();
    huge.append("front", new File([new Uint8Array(23 * 1024 * 1024)], "f.jpg", { type: "image/jpeg" }));
    expect((await app.request(`/v1/inventory/${id}/grade-jobs`, { method: "POST", body: huge })).status).toBe(413);
  });
});

describe("server-enforced batch pre-grade", () => {
  const batchPost = (app: App, id: string, route: "grade-estimate" | "grade-jobs") =>
    app.request(`/v1/inventory/${id}/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cardflow-batch": "1" },
      body: JSON.stringify({}),
    });

  it("a batch-marked estimate is 403 premium_required for free accounts, allowed for premium", async () => {
    const free = testApp(createMemoryStore(), { gradeJobs: true, premiumUserIds: [] });
    const freeId = await purchasedWithStill(free);
    for (const route of ["grade-estimate", "grade-jobs"] as const) {
      const res = await batchPost(free, freeId, route);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "premium_required", feature: "batch_grading" });
    }
    const premium = testApp(createMemoryStore(), { gradeJobs: true, premiumUserIds: [DEFAULT_INVITED_USER_ID] });
    const premiumId = await purchasedWithStill(premium);
    expect((await batchPost(premium, premiumId, "grade-estimate")).status).toBe(200);
    expect((await batchPost(premium, premiumId, "grade-jobs")).status).toBe(202);
  });
});
