import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CARDSIGHT_CONSENT_COPY,
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

  it("disclosure names CardSight and its image-use terms; permission text names the provider; no AI wording", () => {
    expect(CARDSIGHT_CONSENT_COPY.body).toContain("CardSight, our card-recognition provider");
    expect(CARDSIGHT_CONSENT_COPY.body).toContain("CardSight's terms allow it to use these images to improve its service");
    expect(PHOTO_PERMISSION_PURPOSE).toContain("uploaded to CardFlow and our card-recognition provider");
    const all = [...Object.values(CARDSIGHT_CONSENT_COPY), PHOTO_PERMISSION_PURPOSE].join(" ");
    expect(all).not.toMatch(/\bAI\b|artificial intelligence|PSA|BGS|CGC/);
  });
});
