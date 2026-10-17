import { afterEach, describe, expect, it } from "vitest";
import { GUEST_FREE_SCANS, SIGNUP_REQUIRED_CODE } from "@cardflow/shared";
import { createApp } from "./app";
import { JORDAN_INVITE_CODE } from "./invited-testers";
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

  it("keeps guests across a restart, moves a signed-up guest's scans, purges the rest after expiry", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    let clock = new Date("2026-10-15T00:00:00Z");
    let cleanup!: () => { guestsPurged: number; scansDeleted: number };
    const opts = { devAutoSession: false, guestMode: true, now: () => clock, onGuestCleanup: (run: typeof cleanup) => (cleanup = run) };
    const app = createApp(store, opts);
    const tokenA = (await call(app, "/v1/sessions/guest", { method: "POST" })).body.token as string;
    const tokenB = (await call(app, "/v1/sessions/guest", { method: "POST" })).body.token as string;
    await call(app, "/v1/scans", { method: "POST", body: scanBody, token: tokenA });
    const [guestA] = store.listScanUserIds("guest_") as [string];
    await call(app, "/v1/scans", { method: "POST", body: scanBody, token: tokenB });
    expect(cleanup()).toEqual({ guestsPurged: 0, scansDeleted: 0 });

    // B signs up: their scan moves to the new account instead of being deleted.
    const signup = await call(app, "/v1/accounts", { method: "POST", body: JSON.stringify({ email: "b@example.com", password: "correct horse battery" }), token: tokenB });
    expect(signup.status).toBe(200);
    expect(signup.body.movedScans).toBe(1);
    const accountId = (signup.body.identity as { userId: string }).userId;
    expect(store.listScans(accountId)).toHaveLength(1);
    expect(store.listScanUserIds("guest_")).toEqual([guestA]);

    // Restart: guest sessions live in the DB, so A keeps scanning.
    const restarted = createApp(store, opts);
    expect((await call(restarted, "/v1/scans", { method: "POST", body: scanBody, token: tokenA })).status).toBe(201);

    // 25 hours later A's 24-hour session has expired and A never signed up: every row goes.
    clock = new Date("2026-10-16T01:00:00Z");
    expect(cleanup()).toEqual({ guestsPurged: 1, scansDeleted: 2 });
    expect(Object.values(store.accounts.countUserRows(guestA)).every((n) => n === 0)).toBe(true);
    expect((await call(restarted, "/v1/inventory", { token: tokenA })).status).toBe(401);
    expect(store.listScans(accountId)).toHaveLength(1);
  });

  it("parallel guest scans can't pass the 3-scan limit", async () => {
    const app = open();
    const token = (await call(app, "/v1/sessions/guest", { method: "POST" })).body.token as string;
    const results = await Promise.all(
      Array.from({ length: 6 }, () => call(app, "/v1/scans", { method: "POST", body: scanBody, token })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(GUEST_FREE_SCANS);
    expect(results.filter((r) => r.status === 403)).toHaveLength(6 - GUEST_FREE_SCANS);
  });

  it("a spoofed X-Forwarded-For doesn't reset the guest mint limit when no proxy is trusted", async () => {
    const app = open({ guestMintsPerHour: 2 });
    const mint = (ip: string) =>
      app.request("/v1/sessions/guest", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip } });
    expect((await mint("1.1.1.1")).status).toBe(200);
    expect((await mint("2.2.2.2")).status).toBe(200);
    expect((await mint("3.3.3.3")).status).toBe(429);
  });
});
