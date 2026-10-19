import { describe, expect, it } from "vitest";
import {
  AGE_GATE_VERSION,
  DEFAULT_INVITED_USER_ID,
  LIVESTREAM_TRIAL_DAYS,
  PREMIUM_REQUIRED_CODE,
  premiumFeatureLine,
} from "@cardflow/shared";
import { createApp } from "./app";
import { createMemoryStore } from "./store";
import { createSqliteStore } from "./sqlite-store";

function storeWithAge(at = "2026-10-18T00:00:00.000Z") {
  const store = createMemoryStore();
  store.ageConfirmations.confirm(DEFAULT_INVITED_USER_ID, AGE_GATE_VERSION, at);
  return store;
}

async function identify(app: ReturnType<typeof createApp>) {
  return app.request("/v1/livestream/identify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: "live_video",
      platform: "ios",
      cardDetected: false,
    }),
  });
}

describe("livestream trial + 18+ (Sean Oct 18)", () => {
  it("refuses identify without the 18+ confirmation", async () => {
    const store = createMemoryStore();
    const app = createApp(store);
    const res = await identify(app);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "age_confirmation_required" });
  });

  it("starts the trial on first use and exposes days left on /access", async () => {
    let now = new Date("2026-10-18T12:00:00.000Z");
    const store = storeWithAge();
    const app = createApp(store, { now: () => now });

    const before = await app.request("/v1/livestream/access");
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({
      ok: true,
      access: { state: "ready", daysLeft: LIVESTREAM_TRIAL_DAYS, trialStartedAt: null },
    });
    expect(store.livestreamTrials.get(DEFAULT_INVITED_USER_ID)).toBeNull();

    expect((await identify(app)).status).toBe(200);
    const started = store.livestreamTrials.get(DEFAULT_INVITED_USER_ID);
    expect(started?.startedAt).toBe("2026-10-18T12:00:00.000Z");

    const during = await (await app.request("/v1/livestream/access")).json() as {
      access: { state: string; daysLeft: number };
    };
    expect(during.access).toMatchObject({ state: "trial", daysLeft: 3 });

    now = new Date("2026-10-21T12:00:01.000Z");
    const lockedAccess = await (await app.request("/v1/livestream/access")).json() as {
      access: { state: string; daysLeft: number };
    };
    expect(lockedAccess.access).toMatchObject({ state: "locked", daysLeft: 0 });

    const locked = await identify(app);
    expect(locked.status).toBe(403);
    expect(await locked.json()).toMatchObject({
      code: PREMIUM_REQUIRED_CODE,
      feature: "livestream_scanner",
      error: premiumFeatureLine("livestream_scanner"),
    });
  });

  it("premium accounts stay unlocked after the trial", async () => {
    let now = new Date("2026-10-18T00:00:00.000Z");
    const store = storeWithAge();
    store.setGradePlan(DEFAULT_INVITED_USER_ID, "premium", now.toISOString());
    const app = createApp(store, { now: () => now });
    expect((await identify(app)).status).toBe(200);
    now = new Date("2026-11-01T00:00:00.000Z");
    expect((await identify(app)).status).toBe(200);
    const access = await (await app.request("/v1/livestream/access")).json() as { access: { state: string } };
    expect(access.access.state).toBe("premium");
  });

  it("SQLite: trial survives restart and is deleted with the account", () => {
    const a = createSqliteStore({ sqlitePath: ":memory:" });
    a.livestreamTrials.start("u1", "2026-10-18T00:00:00.000Z");
    expect(a.livestreamTrials.get("u1")).toEqual({ startedAt: "2026-10-18T00:00:00.000Z" });
    expect(a.livestreamTrials.deleteUser("u1")).toBe(1);
    expect(a.livestreamTrials.get("u1")).toBeNull();
    a.close();
  });
});
