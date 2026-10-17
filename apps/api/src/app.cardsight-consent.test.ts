import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CARDSIGHT_CONSENT_COPY,
  CAMERA_USAGE_DESCRIPTION,
  CARDSIGHT_CONSENT_VERSION,
  PHOTO_PERMISSION_PURPOSE,
  type CardRecognitionProvider,
  type IdentifyCardRequest,
} from "@cardflow/shared";
import { identifyCardMock } from "@cardflow/shared/mock";
import { createApp } from "./app";
import { createCardSightRecognitionProvider } from "./cardsight-adapter";
import { createRecognitionCache } from "./server-cache";
import { createSqliteStore } from "./sqlite-store";
import { createMemoryStore, type StorePort } from "./store";

const STORED_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function spy(name: string, ok = true): { calls: IdentifyCardRequest[]; provider: CardRecognitionProvider } {
  const calls: IdentifyCardRequest[] = [];
  return {
    calls,
    provider: {
      name: name as never,
      async identifyCard(req) {
        calls.push(req);
        if (!ok) return { ok: false, provider: name, detections: [], error: { code: "PROVIDER_UNAVAILABLE", message: "down" } } as never;
        return { ...identifyCardMock("high-confidence"), provider: name } as never;
      },
    },
  };
}

function setup(
  opts: {
    cardSightOk?: boolean;
    serverCache?: boolean;
    cardSightUserCaps?: { signedIn: number; guest: number };
    cardSight?: CardRecognitionProvider;
    now?: () => Date;
  } = {},
) {
  const inner = createMemoryStore();
  const store: StorePort = {
    ...inner,
    readStoredScanImage: (_scanId, storageRef) => ({ storageRef, mimeType: "image/jpeg", bytes: STORED_JPEG }),
  };
  const local = spy("mock");
  const cardSight = spy("cardsight", opts.cardSightOk ?? true);
  const app = createApp(store, {
    recognition: local.provider,
    cardSight: opts.cardSight ?? cardSight.provider,
    liveIdentifyEnabled: true,
    serverCache: opts.serverCache ?? false,
    ...(opts.cardSightUserCaps ? { cardSightUserCaps: opts.cardSightUserCaps } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  return { app, store, local, cardSight };
}

type App = ReturnType<typeof createApp>;
async function scan(app: App) {
  const form = new FormData();
  form.append("captureMethod", "camera_photo");
  form.append("image", new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], "still.jpg", { type: "image/jpeg" }));
  const res = await app.request("/v1/scans", { method: "POST", body: form });
  expect(res.status).toBe(201);
}
async function consent(app: App, body?: unknown) {
  const res = await app.request("/v1/consents/cardsight", {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { consent?: Record<string, unknown>; error?: string } };
}
async function currentUserId(app: App) {
  return ((await (await app.request("/v1/identity")).json()) as { identity: { userId: string } }).identity.userId;
}

describe("CardSight consent: the server enforces it before calling the adapter", () => {
  it("without consent, photos never reach CardSight (local matcher only)", async () => {
    const { app, local, cardSight } = setup();
    await scan(app);
    expect(cardSight.calls).toHaveLength(0);
    expect(local.calls.length).toBeGreaterThan(0);
  });

  it("with current-version consent CardSight runs; after withdrawal it stops", async () => {
    const { app, local, cardSight } = setup();
    expect((await consent(app, { granted: true, version: CARDSIGHT_CONSENT_VERSION })).status).toBe(200);
    await scan(app);
    expect(cardSight.calls).toHaveLength(1);
    expect(cardSight.calls[0]!.image).toEqual(STORED_JPEG);
    expect(local.calls).toHaveLength(0);

    const off = await consent(app, { granted: false });
    expect(off.body.consent).toMatchObject({ granted: false, needsPrompt: false });
    expect(off.body.consent!.withdrawnAt).toEqual(expect.any(String));
    await scan(app);
    expect(cardSight.calls).toHaveLength(1);
    expect(local.calls.length).toBeGreaterThan(0);
  });

  it("falls back to the local matcher when CardSight misses", async () => {
    const { app, local, cardSight } = setup({ cardSightOk: false });
    await consent(app, { granted: true, version: CARDSIGHT_CONSENT_VERSION });
    await scan(app);
    expect(cardSight.calls).toHaveLength(1);
    expect(local.calls.length).toBeGreaterThan(0);
  });

  it("consent to an older version doesn't count (asked again)", async () => {
    const { app, store, cardSight } = setup();
    store.consents.grant(await currentUserId(app), "cardsight", "2020-01-01", "2020-01-01T00:00:00.000Z");
    expect((await consent(app)).body.consent).toMatchObject({ granted: false, version: "2020-01-01", needsPrompt: true });
    await scan(app);
    expect(cardSight.calls).toHaveLength(0);
  });
});

describe.each(["sqlite", "memory"] as const)("guest consent moves to the account at sign-up (%s)", (kind) => {
  async function req(app: App, pathName: string, init: { method?: string; body?: unknown; token?: string } = {}) {
    const res = await app.request(pathName, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
  let store: StorePort;
  function open() {
    store = kind === "sqlite" ? createSqliteStore({ sqlitePath: ":memory:" }) : createMemoryStore();
    return createApp(store, { devAutoSession: false, guestMode: true });
  }

  it("a guest's Allow is the new account's consent (same version and time)", async () => {
    const app = open();
    const guest = (await req(app, "/v1/sessions/guest", { method: "POST" })).body.token as string;
    // Guests can see and answer the prompt before their first upload.
    expect(((await req(app, "/v1/consents/cardsight", { token: guest })).body.consent as Record<string, unknown>).needsPrompt).toBe(true);
    const given = await req(app, "/v1/consents/cardsight", { body: { granted: true, version: CARDSIGHT_CONSENT_VERSION }, token: guest });
    expect(given.status).toBe(200);
    const grantedAt = (given.body.consent as { grantedAt: string }).grantedAt;

    const up = await req(app, "/v1/accounts", { body: { email: "guest@example.com", password: "correct horse battery" }, token: guest });
    expect(up.status).toBe(200);
    const account = await req(app, "/v1/consents/cardsight", { token: up.body.token as string });
    expect(account.body.consent).toMatchObject({ granted: true, version: CARDSIGHT_CONSENT_VERSION, grantedAt, needsPrompt: false });
    // The guest's consent history moves with it.
    const accountId = ((await req(app, "/v1/identity", { token: up.body.token as string })).body.identity as { userId: string }).userId;
    expect(store.consents.events(accountId).map((e) => [e.kind, e.at])).toEqual([["grant", grantedAt]]);
  });

  it("a guest's Don't allow moves too, and an account's own earlier answer wins on sign-in", async () => {
    const app = open();
    const g1 = (await req(app, "/v1/sessions/guest", { method: "POST" })).body.token as string;
    await req(app, "/v1/consents/cardsight", { body: { granted: false }, token: g1 });
    const up = await req(app, "/v1/accounts", { body: { email: "sam@example.com", password: "correct horse battery" }, token: g1 });
    const token = up.body.token as string;
    expect((await req(app, "/v1/consents/cardsight", { token })).body.consent).toMatchObject({ granted: false, needsPrompt: false });
    await req(app, "/v1/consents/cardsight", { body: { granted: true, version: CARDSIGHT_CONSENT_VERSION }, token });

    // A later guest who declines, then signs in: the account keeps its own Allow.
    const g2 = (await req(app, "/v1/sessions/guest", { method: "POST" })).body.token as string;
    await req(app, "/v1/consents/cardsight", { body: { granted: false }, token: g2 });
    const signIn = await req(app, "/v1/sessions/password", { body: { email: "sam@example.com", password: "correct horse battery" }, token: g2 });
    expect((await req(app, "/v1/consents/cardsight", { token: signIn.body.token as string })).body.consent).toMatchObject({ granted: true });
  });
});

describe("CardSight consent API", () => {
  it("starts unanswered; agreeing needs the current version; stores version + timestamp", async () => {
    const { app } = setup();
    expect((await consent(app)).body.consent).toEqual({
      granted: false,
      version: null,
      grantedAt: null,
      declinedAt: null,
      withdrawnAt: null,
      currentVersion: CARDSIGHT_CONSENT_VERSION,
      needsPrompt: true,
    });
    expect((await consent(app, { granted: true })).status).toBe(409);
    expect((await consent(app, { granted: true, version: "old" })).status).toBe(409);
    expect((await consent(app, { granted: "yes" })).status).toBe(400);
    const on = await consent(app, { granted: true, version: CARDSIGHT_CONSENT_VERSION });
    expect(on.body.consent).toMatchObject({ granted: true, version: CARDSIGHT_CONSENT_VERSION, withdrawnAt: null, needsPrompt: false });
    expect(Date.parse(on.body.consent!.grantedAt as string)).not.toBeNaN();
  });

  it("declining the prompt is remembered (no second prompt), and nothing goes to CardSight", async () => {
    const { app, cardSight } = setup();
    const declined = await consent(app, { granted: false });
    expect(declined.body.consent).toMatchObject({ granted: false, needsPrompt: false });
    await scan(app);
    expect(cardSight.calls).toHaveLength(0);
  });

  it("SQLite: consent survives a restart and is removed with the account", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-consent-"));
    dirs.push(dir);
    const file = path.join(dir, "c.sqlite");
    const first = createSqliteStore({ sqlitePath: file });
    first.consents.grant("u1", "cardsight", CARDSIGHT_CONSENT_VERSION, "2026-10-17T03:00:00.000Z");
    first.close();
    const second = createSqliteStore({ sqlitePath: file });
    expect(second.consents.get("u1", "cardsight")).toMatchObject({ version: CARDSIGHT_CONSENT_VERSION, grantedAt: "2026-10-17T03:00:00.000Z", withdrawnAt: null });
    second.consents.withdraw("u1", "cardsight", "2026-10-18T00:00:00.000Z");
    expect(second.consents.get("u1", "cardsight")).toMatchObject({ grantedAt: "2026-10-17T03:00:00.000Z", withdrawnAt: "2026-10-18T00:00:00.000Z" });
    expect(second.accounts.deleteAllUserRows("u1").provider_consents).toBe(1);
    expect(second.consents.get("u1", "cardsight")).toBeNull();
    second.close();
  });

  it("disclosure names CardSight and says what its terms allow; only the two disclosure strings mention AI", () => {
    expect(CARDSIGHT_CONSENT_COPY.body).toContain("CardSight, our card-recognition provider");
    expect(CARDSIGHT_CONSENT_COPY.body).toContain("CardSight's terms let it keep these images and use them to train its AI models");
    expect(CARDSIGHT_CONSENT_COPY.settingsHelp).toContain("doesn't remove photos CardSight already has");
    expect(CAMERA_USAGE_DESCRIPTION).toContain(PHOTO_PERMISSION_PURPOSE);
    const { body, settingsHelp, ...rest } = CARDSIGHT_CONSENT_COPY;
    expect(body && settingsHelp).toBeTruthy();
    expect([...Object.values(rest), CAMERA_USAGE_DESCRIPTION].join(" ")).not.toMatch(/\bAI\b|artificial intelligence|PSA|BGS|CGC/);
  });

});

describe("Backend review M4: consent history is append-only and a decline is never a grant", () => {
  it.each(["memory", "sqlite"] as const)("%s: decline, grant, withdraw each append one event", async (kind) => {
    const inner = kind === "sqlite" ? createSqliteStore({ sqlitePath: ":memory:" }) : createMemoryStore();
    const app = createApp(inner, { liveIdentifyEnabled: true });
    const userId = await currentUserId(app);

    const declined = await consent(app, { granted: false });
    expect(declined.body.consent).toMatchObject({ granted: false, grantedAt: null, withdrawnAt: null, needsPrompt: false });
    expect(declined.body.consent!.declinedAt).toEqual(expect.any(String));
    expect(inner.consents.get(userId, "cardsight")).toMatchObject({ grantedAt: null, declinedAt: expect.any(String) });
    expect(inner.consents.events(userId).map((e) => e.kind)).toEqual(["decline"]);

    // Saying no again changes nothing and adds nothing.
    await consent(app, { granted: false });
    expect(inner.consents.events(userId)).toHaveLength(1);

    await consent(app, { granted: true, version: CARDSIGHT_CONSENT_VERSION });
    const off = await consent(app, { granted: false });
    expect(off.body.consent).toMatchObject({ granted: false, declinedAt: null, withdrawnAt: expect.any(String) });
    const events = inner.consents.events(userId);
    expect(events.map((e) => e.kind)).toEqual(["decline", "grant", "withdraw"]);
    expect(events.every((e) => e.version === CARDSIGHT_CONSENT_VERSION && e.provider === "cardsight")).toBe(true);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(3);

    // Account deletion removes the history with the rest of the user's rows.
    inner.accounts.deleteAllUserRows(userId);
    expect(inner.consents.events(userId)).toEqual([]);
  });

  it("SQLite: history survives a restart, oldest first", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-consent-events-"));
    dirs.push(dir);
    const file = path.join(dir, "e.sqlite");
    const first = createSqliteStore({ sqlitePath: file });
    first.consents.decline("u1", "cardsight", CARDSIGHT_CONSENT_VERSION, "2026-10-17T03:00:00.000Z");
    first.consents.grant("u1", "cardsight", CARDSIGHT_CONSENT_VERSION, "2026-10-18T03:00:00.000Z");
    first.close();
    const second = createSqliteStore({ sqlitePath: file });
    expect(second.consents.events("u1").map((e) => [e.kind, e.at])).toEqual([
      ["decline", "2026-10-17T03:00:00.000Z"],
      ["grant", "2026-10-18T03:00:00.000Z"],
    ]);
    second.close();
  });
});

describe("Backend review M5: per-user monthly CardSight cap", () => {
  it("signed-in users fall back to the local matcher once their cap is used; it resets next month", async () => {
    let at = new Date("2026-10-20T12:00:00.000Z");
    const { app, store, local, cardSight } = setup({ cardSightUserCaps: { signedIn: 2, guest: 1 }, now: () => at });
    await consent(app, { granted: true, version: CARDSIGHT_CONSENT_VERSION });
    await scan(app);
    await scan(app);
    expect(local.calls).toHaveLength(0);
    await scan(app);
    expect(cardSight.calls).toHaveLength(2);
    expect(local.calls.length).toBeGreaterThan(0);
    expect(store.consents.monthlyUse(await currentUserId(app), "2026-10")).toBe(2);

    at = new Date("2026-11-01T00:00:00.000Z");
    await scan(app);
    expect(cardSight.calls).toHaveLength(3);
  });

  it("cache hits don't use up the cap", async () => {
    const { app, store, cardSight } = setup({ cardSightUserCaps: { signedIn: 1, guest: 1 }, serverCache: true });
    await consent(app, { granted: true, version: CARDSIGHT_CONSENT_VERSION });
    await scan(app);
    await scan(app);
    expect(cardSight.calls).toHaveLength(1);
    const month = new Date().toISOString().slice(0, 7);
    expect(store.consents.monthlyUse(await currentUserId(app), month)).toBe(1);
  });

  it.each(["memory", "sqlite"] as const)("%s: guests get the smaller cap (0 = never)", async (kind) => {
    const inner = kind === "sqlite" ? createSqliteStore({ sqlitePath: ":memory:" }) : createMemoryStore();
    const store: StorePort = {
      ...inner,
      readStoredScanImage: (_scanId, storageRef) => ({ storageRef, mimeType: "image/jpeg", bytes: STORED_JPEG }),
    };
    const local = spy("mock");
    const cardSight = spy("cardsight");
    const app = createApp(store, {
      devAutoSession: false,
      guestMode: true,
      recognition: local.provider,
      cardSight: cardSight.provider,
      liveIdentifyEnabled: true,
      serverCache: false,
      cardSightUserCaps: { signedIn: 50, guest: 1 },
    });
    const guest = ((await (await app.request("/v1/sessions/guest", { method: "POST" })).json()) as { token: string }).token;
    const auth = { authorization: `Bearer ${guest}` };
    await app.request("/v1/consents/cardsight", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ granted: true, version: CARDSIGHT_CONSENT_VERSION }),
    });
    for (let i = 0; i < 2; i += 1) {
      const form = new FormData();
      form.append("captureMethod", "camera_photo");
      form.append("image", new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], "still.jpg", { type: "image/jpeg" }));
      expect((await app.request("/v1/scans", { method: "POST", body: form, headers: auth })).status).toBe(201);
    }
    expect(cardSight.calls).toHaveLength(1);
    expect(local.calls.length).toBeGreaterThan(0);

    const none = setup({ cardSightUserCaps: { signedIn: 0, guest: 0 } });
    await consent(none.app, { granted: true, version: CARDSIGHT_CONSENT_VERSION });
    await scan(none.app);
    expect(none.cardSight.calls).toHaveLength(0);
  });
});

describe("Backend review: recognition cache and fallbacks", () => {
  it("cache entries are separated by source (CardSight vs local matcher)", async () => {
    const cache = createRecognitionCache();
    const image = { bytes: STORED_JPEG, mimeType: "image/jpeg" };
    let calls = 0;
    const identify = async () => {
      calls += 1;
      return { ...identifyCardMock("high-confidence"), vendorRequestId: `req-${calls}` } as never;
    };
    await cache.getOrIdentify(image, "cardsight+mock", identify);
    await cache.getOrIdentify(image, "mock", identify);
    expect(calls).toBe(2);
    await cache.getOrIdentify(image, "cardsight+mock", identify);
    expect(calls).toBe(2);
  });

  it("a cache hit never carries the vendor request id", async () => {
    const cache = createRecognitionCache();
    const image = { bytes: STORED_JPEG, mimeType: "image/jpeg" };
    const identify = async () => ({ ...identifyCardMock("high-confidence"), vendorRequestId: "cs-req-1" }) as never;
    const first = await cache.getOrIdentify(image, "cardsight+mock", identify);
    expect(first.vendorRequestId).toBe("cs-req-1");
    const hit = await cache.getOrIdentify(image, "cardsight+mock", identify);
    expect(hit.vendorRequestId).toBeNull();
    expect(hit.detections).toEqual(first.detections);
  });

  it("after withdrawal, a cached CardSight answer for the same photo is not reused", async () => {
    const { app, local, cardSight } = setup({ serverCache: true });
    await consent(app, { granted: true, version: CARDSIGHT_CONSENT_VERSION });
    await scan(app);
    await scan(app);
    expect(cardSight.calls).toHaveLength(1);
    expect(local.calls).toHaveLength(0);
    await consent(app, { granted: false });
    await scan(app);
    expect(cardSight.calls).toHaveLength(1);
    expect(local.calls.length).toBeGreaterThan(0);
  });

  it("when the global CardSight budget is used up, nothing is sent and the local matcher answers", async () => {
    const fetchCalls: unknown[] = [];
    const adapter = createCardSightRecognitionProvider({
      apiKey: "test-key",
      fetch: (async (...args: unknown[]) => {
        fetchCalls.push(args);
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
      consumeBudget: () => false,
    });
    const { app, local } = setup({ cardSight: adapter });
    await consent(app, { granted: true, version: CARDSIGHT_CONSENT_VERSION });
    await scan(app);
    expect(fetchCalls).toHaveLength(0);
    expect(local.calls.length).toBeGreaterThan(0);
  });

  it("livestream identify never calls CardSight, even with consent", async () => {
    const { app, cardSight } = setup();
    await consent(app, { granted: true, version: CARDSIGHT_CONSENT_VERSION });
    const res = await app.request("/v1/livestream/identify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "live_video",
        platform: "ios",
        cardDetected: true,
        classifiedTcgdexId: "base1-58",
        identityCropJpeg: Buffer.from(STORED_JPEG).toString("base64"),
      }),
    });
    expect(res.status).toBe(200);
    expect(cardSight.calls).toHaveLength(0);
  });
});
