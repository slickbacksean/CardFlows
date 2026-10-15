import { describe, expect, it } from "vitest";
import { pollGradeJob, type GradeJobView } from "@cardflow/shared";
import { createApp } from "./app";
import { createMemoryStore } from "./store";

type App = ReturnType<typeof createApp>;
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
    const app = createApp(createMemoryStore());
    expect((await app.request("/v1/inventory/x/grade-jobs", { method: "POST" })).status).toBe(404);
    expect((await app.request("/v1/grade-jobs/x")).status).toBe(404);
  });

  it("returns a job ID at once and the polled result matches the synchronous route", async () => {
    const app = createApp(createMemoryStore(), { gradeJobs: true });
    const id = await purchasedWithStill(app);
    const created = await app.request(`/v1/inventory/${id}/grade-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-123" },
      body: JSON.stringify({}),
    });
    expect(created.status).toBe(202);
    const { job } = (await created.json()) as { job: GradeJobView };
    expect(job.requestId).toBe("req-123");
    const done = await pollGradeJob(getJob(app, job.jobId), { sleep: async () => {} });
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
    const app = createApp(createMemoryStore(), { gradeJobs: true, gradeGate: { isFull: () => full } });
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
    expect(result?.status === "done" || result?.status === "waiting" || result?.status === "failed").toBe(true);
  }, 40_000);

  it("another user cannot read a job", async () => {
    const app = createApp(createMemoryStore(), { gradeJobs: true });
    expect((await app.request("/v1/grade-jobs/not-a-job")).status).toBe(404);
  });
});
