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

function setup(opts: { cardSightOk?: boolean } = {}) {
  const inner = createMemoryStore();
  const store: StorePort = {
    ...inner,
    readStoredScanImage: (_scanId, storageRef) => ({ storageRef, mimeType: "image/jpeg", bytes: STORED_JPEG }),
  };
  const local = spy("mock");
  const cardSight = spy("cardsight", opts.cardSightOk ?? true);
  const app = createApp(store, { recognition: local.provider, cardSight: cardSight.provider, liveIdentifyEnabled: true });
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
  function open() {
    const store = kind === "sqlite" ? createSqliteStore({ sqlitePath: ":memory:" }) : createMemoryStore();
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
