import { afterEach, describe, expect, it, vi } from "vitest";
import { AGE_GATE_VERSION, GUEST_SESSION_TTL_MS, GUEST_SIGNUP_COPY, SIGNUP_REQUIRED_CODE, mapRecognitionToCatalog } from "@cardflow/shared";
import { identifyCardMock } from "@cardflow/shared/mock";
import { createApp } from "./app";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";
import type { ScanRecord } from "./store";

/** Sean (Oct 17, 8:36 PM PT): guests browse; sign-up (the free account) before any scan, grade or save. */
const stores: SqliteStorePort[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  vi.unstubAllEnvs();
});

function openStore() {
  const store = createSqliteStore({ sqlitePath: ":memory:" });
  stores.push(store);
  return store;
}

function open(options: Parameters<typeof createApp>[1] = {}) {
  const store = openStore();
  return { store, app: createApp(store, { devAutoSession: false, guestMode: true, ...options }) };
}

async function call(app: ReturnType<typeof createApp>, path: string, init: RequestInit & { token?: string } = {}) {
  const res = await app.request(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const mint = async (app: ReturnType<typeof createApp>) => (await call(app, "/v1/sessions/guest", { method: "POST" })).body.token as string;

/** A scan written before browse-only guests (old app builds could make up to 3). */
async function legacyGuestScan(userId: string): Promise<ScanRecord> {
  const recognition = identifyCardMock("high-confidence");
  return {
    scanId: crypto.randomUUID(),
    userId,
    capturedAt: new Date().toISOString(),
    captureMethod: "camera_photo",
    scenario: "high-confidence",
    preInventoryState: "scan_captured",
    cardflowCardId: null,
    confirmationId: null,
    inventoryItemId: null,
    imageStorageRef: null,
    imageMimeType: null,
    recognition,
    mapping: await mapRecognitionToCatalog(recognition),
  };
}

const json = (value: unknown) => JSON.stringify(value);

describe("browse-only guests", () => {
  it("a guest session is browse-only, lasts 24 hours and has no scan allowance", async () => {
    const { app } = open({ now: () => new Date("2026-10-17T20:00:00.000Z") });
    const guest = await call(app, "/v1/sessions/guest", { method: "POST" });
    expect(guest.status).toBe(200);
    expect(guest.body).toMatchObject({ guest: true, browseOnly: true, identity: { label: "Guest" } });
    expect(Date.parse(guest.body.expiresAt as string) - Date.parse("2026-10-17T20:00:00.000Z")).toBe(GUEST_SESSION_TTL_MS);
    expect(guest.body).not.toHaveProperty("freeScans");
    expect(guest.body).not.toHaveProperty("scansRemaining");
  });

  it("403 signup_required on every scan, grade, livestream, save, purchase, watchlist, inventory and CardSight route", async () => {
    const { app } = open();
    const token = await mint(app);
    const refused: Array<[string, string, string?]> = [
      ["POST", "/v1/scans", json({ captureMethod: "camera_photo", scenario: "high-confidence" })],
      ["GET", "/v1/scans/s1"],
      ["GET", "/v1/scans/s1/image"],
      ["POST", "/v1/scans/s1/confirm", json({ tcgdexId: "base1-58" })],
      ["POST", "/v1/scans/s1/reject", json({})],
      ["POST", "/v1/livestream/identify", json({ source: "live_video" })],
      ["GET", "/v1/livestream/guesses/base1-58"],
      ["GET", "/v1/grade/quota"],
      ["POST", "/v1/grade/credits/consume", json({})],
      ["POST", "/v1/grade/credits", json({})],
      ["GET", "/v1/grade-jobs/j1"],
      ["POST", "/v1/inventory/i1/grade-jobs", json({})],
      ["GET", "/v1/inventory/i1/grade-photos/front"],
      ["GET", "/v1/inventory/i1/grade-history"],
      ["POST", "/v1/inventory/i1/grade-history", json({})],
      ["POST", "/v1/grading/batch", json({})],
      ["POST", "/v1/grading/submitted", json({})],
      ["POST", "/v1/grading/returned", json({})],
      ["PATCH", "/v1/grading/submitted/i1", json({})],
      ["POST", "/v1/inventory/purchased", json({ tcgdexId: "base1-58" })],
      ["POST", "/v1/inventory/watchlist", json({ tcgdexId: "base1-58" })],
      ["POST", "/v1/inventory/i1/purchased", json({})],
      ["POST", "/v1/inventory/i1/purchase", json({})],
      ["DELETE", "/v1/inventory/i1"],
      ["POST", "/v1/inventory/i1/drafts", json({})],
      ["PATCH", "/v1/drafts/d1", json({})],
      ["POST", "/v1/sales/i1", json({})],
      ["PATCH", "/v1/preferences", json({})],
      ["POST", "/v1/max-buy", json({})],
      ["POST", "/v1/pricing/cards/base1-58/yours", json({})],
      ["GET", "/v1/consents/cardsight"],
      ["POST", "/v1/consents/cardsight", json({ granted: true })],
      ["GET", "/v1/age-confirmation"],
      ["POST", "/v1/age-confirmation", json({ ageConfirmed18Plus: true })],
    ];
    for (const [method, path, body] of refused) {
      const res = await call(app, path, { method, body, token });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body, `${method} ${path}`).toMatchObject({ code: SIGNUP_REQUIRED_CODE, error: GUEST_SIGNUP_COPY.body });
    }
    // A multipart scan (the app's real upload) is refused too.
    const form = new FormData();
    form.append("captureMethod", "camera_photo");
    form.append("image", new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], "still.jpg", { type: "image/jpeg" }));
    const upload = await app.request("/v1/scans", { method: "POST", body: form, headers: { authorization: `Bearer ${token}` } });
    expect(upload.status).toBe(403);
    expect(await upload.json()).toMatchObject({ code: SIGNUP_REQUIRED_CODE, reason: "scan" });
  });

  it("the browse screens keep working (empty states)", async () => {
    const { app } = open();
    const token = await mint(app);
    expect((await call(app, "/v1/identity", { token })).body.identity).toMatchObject({ label: "Guest" });
    const inventory = await call(app, "/v1/inventory", { token });
    expect(inventory.status).toBe(200);
    expect(inventory.body.items).toEqual([]);
    for (const path of ["/v1/collection", "/v1/portfolio", "/v1/grading", "/v1/preferences", "/v1/sales", "/v1/status"]) {
      expect((await call(app, path, { token })).status, path).toBe(200);
    }
  });

  it("a guest can still delete their session data", async () => {
    const { app } = open();
    const token = await mint(app);
    const deleted = await call(app, "/v1/account/delete", { method: "POST", body: "{}", token });
    expect(deleted.status).toBe(200);
    expect(deleted.body.ok).toBe(true);
    expect((await call(app, "/v1/inventory", { token })).status).toBe(401);
  });

  it("is off by default, off with dev auto-session, and rate-limited per IP; CARD_FLOW_GUEST_SCANS no longer turns it on", async () => {
    const store = openStore();
    expect((await call(createApp(store, { devAutoSession: false }), "/v1/sessions/guest", { method: "POST" })).status).toBe(404);
    expect((await call(createApp(store, { devAutoSession: true, guestMode: true }), "/v1/sessions/guest", { method: "POST" })).status).toBe(404);
    vi.stubEnv("CARD_FLOW_GUEST_SCANS", "true");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await call(createApp(store, { devAutoSession: false }), "/v1/sessions/guest", { method: "POST" })).status).toBe(404);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("CARD_FLOW_GUEST_SCANS is ignored"));
    warn.mockRestore();
    vi.stubEnv("CARD_FLOW_GUEST_BROWSE", "true");
    expect((await call(createApp(store, { devAutoSession: false }), "/v1/sessions/guest", { method: "POST" })).status).toBe(200);
    const { app } = open({ guestMintsPerHour: 2 });
    expect((await call(app, "/v1/sessions/guest", { method: "POST" })).status).toBe(200);
    expect((await call(app, "/v1/sessions/guest", { method: "POST" })).status).toBe(200);
    expect((await call(app, "/v1/sessions/guest", { method: "POST" })).status).toBe(429);
  });

  it("an unknown bearer is still 401", async () => {
    expect((await call(open().app, "/v1/inventory", { token: "nope" })).status).toBe(401);
  });

  it("keeps guests across a restart and purges them after the 24 hours; scans from before the change move at sign-up", async () => {
    const store = openStore();
    let clock = new Date("2026-10-15T00:00:00Z");
    let cleanup!: () => { guestsPurged: number; scansDeleted: number };
    const opts = { devAutoSession: false, guestMode: true, now: () => clock, onGuestCleanup: (run: typeof cleanup) => (cleanup = run) };
    const app = createApp(store, opts);
    const tokenA = await mint(app);
    const tokenB = await mint(app);
    const idOf = async (token: string) => ((await call(app, "/v1/identity", { token })).body.identity as { userId: string }).userId;
    const [guestA, guestB] = [await idOf(tokenA), await idOf(tokenB)];
    store.saveScan(await legacyGuestScan(guestA));
    store.saveScan(await legacyGuestScan(guestB));
    expect(cleanup()).toEqual({ guestsPurged: 0, scansDeleted: 0 });

    const signup = await call(app, "/v1/accounts", {
      method: "POST",
      body: json({ email: "b@example.com", password: "correct horse battery", ageConfirmed18Plus: true, ageGateVersion: AGE_GATE_VERSION }),
      token: tokenB,
    });
    expect(signup.status).toBe(200);
    expect(signup.body.movedScans).toBe(1);
    const accountId = (signup.body.identity as { userId: string }).userId;
    expect(store.listScans(accountId)).toHaveLength(1);
    expect(Object.entries(store.accounts.countUserRows(guestB)).filter(([, n]) => n > 0)).toEqual([]);

    // Restart: guest sessions live in the DB.
    const restarted = createApp(store, opts);
    expect((await call(restarted, "/v1/inventory", { token: tokenA })).status).toBe(200);

    // 25 hours later A's session has expired: every row goes.
    clock = new Date("2026-10-16T01:00:00Z");
    expect(cleanup()).toEqual({ guestsPurged: 1, scansDeleted: 1 });
    expect(Object.values(store.accounts.countUserRows(guestA)).every((n) => n === 0)).toBe(true);
    expect((await call(restarted, "/v1/inventory", { token: tokenA })).status).toBe(401);
  });

  it("a spoofed X-Forwarded-For doesn't reset the guest mint limit when no proxy is trusted", async () => {
    const { app } = open({ guestMintsPerHour: 2 });
    const mintFrom = (ip: string) =>
      app.request("/v1/sessions/guest", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip } });
    expect((await mintFrom("1.1.1.1")).status).toBe(200);
    expect((await mintFrom("2.2.2.2")).status).toBe(200);
    expect((await mintFrom("3.3.3.3")).status).toBe(429);
  });
});
