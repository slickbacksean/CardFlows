import { afterEach, describe, expect, it } from "vitest";
import { GUEST_FREE_SCANS, SIGNUP_REQUIRED_CODE } from "@cardflow/shared";
import { createApp } from "./app";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";

const stores: SqliteStorePort[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function open(options: Parameters<typeof createApp>[1] = {}) {
  const store = createSqliteStore({ sqlitePath: ":memory:" });
  stores.push(store);
  return createApp(store, { devAutoSession: false, guestMode: true, ...options });
}

async function call(app: ReturnType<typeof createApp>, path: string, init: RequestInit & { token?: string } = {}) {
  const res = await app.request(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const scanBody = JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" });

describe("D9 guest scans", () => {
  it("gives 3 free scans, then requires sign-up on the 4th", async () => {
    const app = open();
    const guest = await call(app, "/v1/sessions/guest", { method: "POST" });
    expect(guest.status).toBe(200);
    expect(guest.body.scansRemaining).toBe(GUEST_FREE_SCANS);
    const token = guest.body.token as string;
    for (let i = 0; i < GUEST_FREE_SCANS; i += 1) {
      expect((await call(app, "/v1/scans", { method: "POST", body: scanBody, token })).status).toBe(201);
    }
    const fourth = await call(app, "/v1/scans", { method: "POST", body: scanBody, token });
    expect(fourth.status).toBe(403);
    expect(fourth.body).toMatchObject({ code: SIGNUP_REQUIRED_CODE, reason: "scan_limit" });
  });

  it("blocks save steps for guests but allows reads", async () => {
    const app = open();
    const token = (await call(app, "/v1/sessions/guest", { method: "POST" })).body.token as string;
    const scan = await call(app, "/v1/scans", { method: "POST", body: scanBody, token });
    const scanId = (scan.body.scan as { scanId: string }).scanId;
    const confirm = await call(app, `/v1/scans/${scanId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ tcgdexId: "base1-58" }),
      token,
    });
    expect(confirm.status).toBe(403);
    expect(confirm.body).toMatchObject({ code: SIGNUP_REQUIRED_CODE, reason: "save" });
    expect((await call(app, "/v1/inventory", { token })).status).toBe(200);
    expect((await call(app, "/v1/identity", { token })).body.identity).toMatchObject({ label: "Guest" });
  });

  it("is off by default, off with dev auto-session, and rate-limited per IP", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    expect((await call(createApp(store, { devAutoSession: false }), "/v1/sessions/guest", { method: "POST" })).status).toBe(404);
    expect((await call(createApp(store, { devAutoSession: true, guestMode: true }), "/v1/sessions/guest", { method: "POST" })).status).toBe(404);
    const app = open({ guestMintsPerHour: 2 });
    expect((await call(app, "/v1/sessions/guest", { method: "POST" })).status).toBe(200);
    expect((await call(app, "/v1/sessions/guest", { method: "POST" })).status).toBe(200);
    expect((await call(app, "/v1/sessions/guest", { method: "POST" })).status).toBe(429);
  });

  it("an unknown bearer is still 401", async () => {
    expect((await call(open(), "/v1/inventory", { token: "nope" })).status).toBe(401);
  });
});
