import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGE_GATE_VERSION,
  CARDSIGHT_CONSENT_VERSION,
  DEFAULT_INVITED_USER_ID,
  type CardRecognitionProvider,
  type IdentifyCardRequest,
} from "@cardflow/shared";
import { identifyCardMock } from "@cardflow/shared/mock";
import { createApp } from "./app";
import { createSqliteStore } from "./sqlite-store";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function spy(name: string, identify?: CardRecognitionProvider["identifyCard"]) {
  const calls: IdentifyCardRequest[] = [];
  const provider: CardRecognitionProvider = {
    name: name as never,
    async identifyCard(req) {
      calls.push(req);
      if (identify) return identify(req);
      return { ...identifyCardMock("high-confidence"), provider: name } as never;
    },
  };
  return { calls, provider };
}

function open(opts: { cap: number; cardSight: CardRecognitionProvider; now?: () => Date }) {
  const dir = mkdtempSync(path.join(tmpdir(), "cardflow-cs-race-"));
  dirs.push(dir);
  const store = createSqliteStore({ sqlitePath: path.join(dir, "t.sqlite") });
  store.ageConfirmations.confirm(DEFAULT_INVITED_USER_ID, AGE_GATE_VERSION, "2026-10-17T00:00:00.000Z");
  const local = spy("mock");
  const app = createApp(store, {
    recognition: local.provider,
    cardSight: opts.cardSight,
    liveIdentifyEnabled: true,
    serverCache: false,
    cardSightUserCaps: { signedIn: opts.cap },
    now: opts.now,
  });
  return { app, store, local };
}

type App = ReturnType<typeof createApp>;
async function consent(app: App) {
  const res = await app.request("/v1/consents/cardsight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ granted: true, version: CARDSIGHT_CONSENT_VERSION }),
  });
  expect(res.status).toBe(200);
}

async function scan(app: App) {
  const form = new FormData();
  form.append("captureMethod", "camera_photo");
  form.append("image", new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], "still.jpg", { type: "image/jpeg" }));
  const res = await app.request("/v1/scans", { method: "POST", body: form });
  expect(res.status).toBe(201);
}

async function userId(app: App) {
  return ((await (await app.request("/v1/identity")).json()) as { identity: { userId: string } }).identity.userId;
}

describe("CardSight per-user cap is atomic under concurrent scans", () => {
  it("cap 1: many overlapping scans call CardSight at most once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const cardSight = spy("cardsight", async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 40));
      inFlight -= 1;
      return { ...identifyCardMock("high-confidence"), provider: "cardsight" } as never;
    });
    const { app, store, local } = open({
      cap: 1,
      cardSight: cardSight.provider,
      now: () => new Date("2026-10-20T12:00:00.000Z"),
    });
    await consent(app);
    await Promise.all(Array.from({ length: 12 }, () => scan(app)));
    expect(cardSight.calls).toHaveLength(1);
    expect(maxInFlight).toBe(1);
    expect(local.calls.length).toBeGreaterThan(0);
    expect(store.consents.monthlyUse(await userId(app), "2026-10")).toBe(1);
    store.close();
  });

  it("cap 2: overlapping scans never exceed the cap", async () => {
    const cardSight = spy("cardsight", async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { ...identifyCardMock("high-confidence"), provider: "cardsight" } as never;
    });
    const { app, store } = open({
      cap: 2,
      cardSight: cardSight.provider,
      now: () => new Date("2026-10-20T12:00:00.000Z"),
    });
    await consent(app);
    await Promise.all(Array.from({ length: 10 }, () => scan(app)));
    expect(cardSight.calls.length).toBeLessThanOrEqual(2);
    expect(store.consents.monthlyUse(await userId(app), "2026-10")).toBe(2);
    store.close();
  });

  it("a failed CardSight call releases the reserved slot", async () => {
    const cardSight = spy("cardsight", async () => {
      return {
        ok: false,
        provider: "cardsight",
        detections: [],
        error: { code: "PROVIDER_TIMEOUT", message: "down" },
      } as never;
    });
    const { app, store } = open({
      cap: 1,
      cardSight: cardSight.provider,
      now: () => new Date("2026-10-20T12:00:00.000Z"),
    });
    await consent(app);
    await scan(app);
    expect(cardSight.calls).toHaveLength(1);
    expect(store.consents.monthlyUse(await userId(app), "2026-10")).toBe(0);
    store.close();
  });
});
