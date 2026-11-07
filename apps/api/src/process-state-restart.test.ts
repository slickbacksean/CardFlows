import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGE_GATE_VERSION,
  CARDSIGHT_CONSENT_VERSION,
  DEFAULT_INVITED_USER_ID,
  pollGradeJob,
  type CardRecognitionProvider,
  type GradeJobView,
  type IdentifyCardRequest,
} from "@cardflow/shared";
import { identifyCardMock } from "@cardflow/shared/mock";
import { createApp } from "./app";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";

const TINY_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const dirs: string[] = [];
const stores: SqliteStorePort[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fileStore() {
  const dir = mkdtempSync(path.join(tmpdir(), "cardflow-process-"));
  dirs.push(dir);
  const sqlitePath = path.join(dir, "t.sqlite");
  const store = createSqliteStore({ sqlitePath });
  stores.push(store);
  return { dir, sqlitePath, store };
}

function reopen(sqlitePath: string) {
  const store = createSqliteStore({ sqlitePath });
  stores.push(store);
  return store;
}

function spy(name: string) {
  const calls: IdentifyCardRequest[] = [];
  const provider: CardRecognitionProvider = {
    name: name as never,
    async identifyCard(req) {
      calls.push(req);
      return { ...identifyCardMock("high-confidence"), provider: name } as never;
    },
  };
  return { calls, provider };
}

async function consent(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/consents/cardsight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ granted: true, version: CARDSIGHT_CONSENT_VERSION }),
  });
  expect(res.status).toBe(200);
}

async function scan(app: ReturnType<typeof createApp>) {
  const form = new FormData();
  form.append("captureMethod", "camera_photo");
  form.append("image", new File([TINY_JPEG], "still.jpg", { type: "image/jpeg" }));
  const res = await app.request("/v1/scans", { method: "POST", body: form });
  expect(res.status).toBe(201);
}

describe("restart-critical process state survives a new createApp on the same SQLite file", () => {
  it("CardSight per-user usage is still counted after a restart", async () => {
    const { sqlitePath, store } = fileStore();
    store.ageConfirmations.confirm(DEFAULT_INVITED_USER_ID, AGE_GATE_VERSION, "2026-10-17T00:00:00.000Z");
    const firstSight = spy("cardsight");
    const app = createApp(store, {
      recognition: spy("mock").provider,
      cardSight: firstSight.provider,
      liveIdentifyEnabled: true,
      serverCache: false,
      cardSightUserCaps: { signedIn: 1 },
      now: () => new Date("2026-10-20T12:00:00.000Z"),
    });
    await consent(app);
    await scan(app);
    expect(firstSight.calls).toHaveLength(1);
    store.close();

    const store2 = reopen(sqlitePath);
    store2.ageConfirmations.confirm(DEFAULT_INVITED_USER_ID, AGE_GATE_VERSION, "2026-10-17T00:00:00.000Z");
    const secondSight = spy("cardsight");
    const app2 = createApp(store2, {
      recognition: spy("mock").provider,
      cardSight: secondSight.provider,
      liveIdentifyEnabled: true,
      serverCache: false,
      cardSightUserCaps: { signedIn: 1 },
      now: () => new Date("2026-10-20T12:00:00.000Z"),
    });
    await consent(app2);
    await scan(app2);
    expect(secondSight.calls).toHaveLength(0);
    expect(store2.consents.monthlyUse(DEFAULT_INVITED_USER_ID, "2026-10")).toBe(1);
  });

  it("grade/detect rate limits still 429 after a restart in the same window", async () => {
    const at = new Date("2026-10-20T12:00:00.000Z");
    const { sqlitePath, store } = fileStore();
    const app = createApp(store, {
      devAutoSession: true,
      gradeRateLimit: { perMinute: 1, perDay: 100 },
      now: () => at,
    });
    expect((await app.request("/v1/grade/pregrade", { method: "POST", body: new FormData() })).status).not.toBe(429);
    store.close();

    const store2 = reopen(sqlitePath);
    const app2 = createApp(store2, {
      devAutoSession: true,
      gradeRateLimit: { perMinute: 1, perDay: 100 },
      now: () => at,
    });
    const limited = await app2.request("/v1/grade/pregrade", { method: "POST", body: new FormData() });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("a deletion receipt still 410s after a restart", async () => {
    const { sqlitePath, store } = fileStore();
    const app = createApp(store, { devAutoSession: false, guestMode: false, orphanSweepIntervalMs: 0 });
    const up = await app.request("/v1/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "restart-del@example.com", password: "correct horse battery", ageConfirmed18Plus: true }),
    });
    expect(up.status).toBe(200);
    const token = ((await up.json()) as { token: string }).token;
    const del = await app.request("/v1/account/delete", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ password: "correct horse battery" }),
    });
    expect(del.status).toBe(200);
    store.close();

    const store2 = reopen(sqlitePath);
    const app2 = createApp(store2, { devAutoSession: false, guestMode: false, orphanSweepIntervalMs: 0 });
    const retry = await app2.request("/v1/account/delete", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ password: "correct horse battery" }),
    });
    expect(retry.status).toBe(410);
    expect(((await retry.json()) as { code: string }).code).toBe("account_deleted");
  });

  it("recognition cache hits after a restart do not call CardSight again", async () => {
    const { sqlitePath, store } = fileStore();
    store.ageConfirmations.confirm(DEFAULT_INVITED_USER_ID, AGE_GATE_VERSION, "2026-10-17T00:00:00.000Z");
    const firstSight = spy("cardsight");
    const app = createApp(store, {
      recognition: spy("mock").provider,
      cardSight: firstSight.provider,
      liveIdentifyEnabled: true,
      serverCache: true,
      cardSightUserCaps: { signedIn: 50 },
    });
    await consent(app);
    await scan(app);
    expect(firstSight.calls).toHaveLength(1);
    store.close();

    const store2 = reopen(sqlitePath);
    store2.ageConfirmations.confirm(DEFAULT_INVITED_USER_ID, AGE_GATE_VERSION, "2026-10-17T00:00:00.000Z");
    const secondSight = spy("cardsight");
    const app2 = createApp(store2, {
      recognition: spy("mock").provider,
      cardSight: secondSight.provider,
      liveIdentifyEnabled: true,
      serverCache: true,
      cardSightUserCaps: { signedIn: 50 },
    });
    await consent(app2);
    await scan(app2);
    expect(secondSight.calls).toHaveLength(0);
  });

  it("a finished grade job can still be polled after a restart", async () => {
    const { sqlitePath, store } = fileStore();
    const app = createApp(store, { gradingEnabled: () => true, gradeJobs: true });
    const form = new FormData();
    form.append("captureMethod", "camera_photo");
    form.append("scenario", "high-confidence");
    form.append("image", new File([TINY_JPEG], "still.jpg", { type: "image/jpeg" }));
    const scanRes = (await (await app.request("/v1/scans", { method: "POST", body: form })).json()) as {
      scan: { scanId: string };
    };
    const confirmed = (await (
      await app.request(`/v1/scans/${scanRes.scan.scanId}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tcgdexId: "base1-58" }),
      })
    ).json()) as { confirmation: { confirmationId: string } };
    const purchased = (await (
      await app.request("/v1/inventory/purchased", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmationId: confirmed.confirmation.confirmationId,
          purchasePrice: "10",
          purchasedAt: "2026-10-01",
        }),
      })
    ).json()) as { item: { inventoryItemId: string } };
    const created = await app.request(`/v1/inventory/${purchased.item.inventoryItemId}/grade-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-restart" },
      body: JSON.stringify({}),
    });
    expect(created.status).toBe(202);
    const { job } = (await created.json()) as { job: GradeJobView };
    const outcome = await pollGradeJob(async () => {
      const res = await app.request(`/v1/grade-jobs/${job.jobId}`);
      return ((await res.json()) as { job: GradeJobView }).job;
    }, { sleep: async () => {} });
    expect(outcome.kind === "finished" ? outcome.job.status : null).toBe("done");
    store.close();

    const store2 = reopen(sqlitePath);
    const app2 = createApp(store2, { gradingEnabled: () => true, gradeJobs: true });
    const replay = await app2.request(`/v1/grade-jobs/${job.jobId}`);
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { job: GradeJobView }).job.status).toBe("done");
  });
});
