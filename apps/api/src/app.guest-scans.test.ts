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

  it("deletes an ended guest's scans and photos (expired, signed up, or lost on restart)", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    let clock = new Date("2026-10-15T00:00:00Z");
    let cleanup!: () => { guestsPurged: number; scansDeleted: number };
    const app = createApp(store, {
      devAutoSession: false,
      guestMode: true,
      now: () => clock,
      onGuestCleanup: (run) => (cleanup = run),
    });
    const tokenA = (await call(app, "/v1/sessions/guest", { method: "POST" })).body.token as string;
    const tokenB = (await call(app, "/v1/sessions/guest", { method: "POST" })).body.token as string;
    const scanA = await call(app, "/v1/scans", { method: "POST", body: scanBody, token: tokenA });
    await call(app, "/v1/scans", { method: "POST", body: scanBody, token: tokenB });
    const guestA = (scanA.body.scan as { userId?: string }).userId ?? null;
    expect(store.listScanUserIds("guest_")).toHaveLength(2);

    // Live guests are kept.
    expect(cleanup()).toEqual({ guestsPurged: 0, scansDeleted: 0 });

    // Signing up ends the guest session and deletes its scans right away.
    const invite = await call(app, "/v1/sessions", { method: "POST", body: JSON.stringify({ inviteCode: JORDAN_INVITE_CODE }), token: tokenB });
    expect(invite.status).toBe(200);
    expect(store.listScanUserIds("guest_")).toHaveLength(1);

    // After the 30-day TTL, guest A's session has ended and the next run purges it.
    clock = new Date("2026-11-20T00:00:00Z");
    const result = cleanup();
    expect(result).toEqual({ guestsPurged: 1, scansDeleted: 1 });
    expect(store.listScanUserIds("guest_")).toHaveLength(0);
    if (guestA) expect(store.listScans(guestA)).toHaveLength(0);

    // Restart: a new app has no live guests, so leftover guest scans go on the first run.
    const app2Token = (await call(app, "/v1/sessions/guest", { method: "POST" })).body.token as string;
    await call(app, "/v1/scans", { method: "POST", body: scanBody, token: app2Token });
    let cleanup2!: () => { guestsPurged: number; scansDeleted: number };
    createApp(store, { devAutoSession: false, guestMode: true, onGuestCleanup: (run) => (cleanup2 = run) });
    expect(cleanup2().scansDeleted).toBe(1);
    expect(store.listScanUserIds("guest_")).toHaveLength(0);
  });
});
