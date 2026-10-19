import { describe, expect, it } from "vitest";
import {
  AGE_GATE_VERSION,
  LIVESTREAM_TRIAL_DAYS,
  PREMIUM_REQUIRED_CODE,
  premiumFeatureLine,
} from "@cardflow/shared";
import { createApp } from "./app";
import { createMemoryStore } from "./store";

const over18 = { ageConfirmed18Plus: true, ageGateVersion: AGE_GATE_VERSION };
const PW = "correct horse battery";

async function identify(app: ReturnType<typeof createApp>, token: string) {
  return app.request("/v1/livestream/identify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      source: "live_video",
      platform: "ios",
      cardDetected: false,
    }),
  });
}

async function access(app: ReturnType<typeof createApp>, token: string) {
  return app.request("/v1/livestream/access", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("livestream trial from account creation (Sean Oct 19)", () => {
  it("refuses identify without the 18+ confirmation", async () => {
    // Dev auto-session invited user with no age confirmation.
    const store = createMemoryStore();
    const app = createApp(store);
    const res = await app.request("/v1/livestream/identify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "live_video", platform: "ios", cardDetected: false }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "age_confirmation_required" });
  });

  it("trial window is account createdAt + 3 days; /access does not start anything", async () => {
    let now = new Date("2026-10-18T12:00:00.000Z");
    const store = createMemoryStore();
    const app = createApp(store, { now: () => now, devAutoSession: false, guestMode: false, ageGate: true });

    const up = await app.request("/v1/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "trial@example.com", password: PW, ...over18 }),
    });
    expect(up.status).toBe(200);
    const { token } = (await up.json()) as { token: string };
    const account = store.accounts.findByEmail("trial@example.com")!;
    expect(account.createdAt).toBe("2026-10-18T12:00:00.000Z");

    const before = await access(app, token);
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({
      ok: true,
      access: {
        state: "trial",
        daysLeft: LIVESTREAM_TRIAL_DAYS,
        trialStartedAt: "2026-10-18T12:00:00.000Z",
      },
    });

    expect((await identify(app, token)).status).toBe(200);

    // Same window after identify — no separate start-on-use row.
    const during = (await (await access(app, token)).json()) as {
      access: { state: string; daysLeft: number; trialStartedAt: string };
    };
    expect(during.access).toMatchObject({
      state: "trial",
      daysLeft: 3,
      trialStartedAt: "2026-10-18T12:00:00.000Z",
    });

    now = new Date("2026-10-21T12:00:01.000Z");
    const lockedAccess = (await (await access(app, token)).json()) as {
      access: { state: string; daysLeft: number };
    };
    expect(lockedAccess.access).toMatchObject({ state: "locked", daysLeft: 0 });

    const locked = await identify(app, token);
    expect(locked.status).toBe(403);
    expect(await locked.json()).toMatchObject({
      code: PREMIUM_REQUIRED_CODE,
      feature: "livestream_scanner",
      error: premiumFeatureLine("livestream_scanner"),
    });
  });

  it("existing accounts measure the trial from their original createdAt", async () => {
    let now = new Date("2026-10-10T00:00:00.000Z");
    const store = createMemoryStore();
    const app = createApp(store, { now: () => now, devAutoSession: false, guestMode: false, ageGate: true });
    const up = await app.request("/v1/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "old@example.com", password: PW, ...over18 }),
    });
    const { token } = (await up.json()) as { token: string };
    expect(store.accounts.findByEmail("old@example.com")!.createdAt).toBe("2026-10-10T00:00:00.000Z");

    // Four days later: trial already over even if they never used livestream.
    now = new Date("2026-10-14T00:00:01.000Z");
    const lockedAccess = (await (await access(app, token)).json()) as { access: { state: string } };
    expect(lockedAccess.access.state).toBe("locked");
    expect((await identify(app, token)).status).toBe(403);
  });

  it("premium accounts stay unlocked after the trial", async () => {
    let now = new Date("2026-10-18T00:00:00.000Z");
    const store = createMemoryStore();
    const app = createApp(store, { now: () => now, devAutoSession: false, guestMode: false, ageGate: true });
    const up = await app.request("/v1/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "prem@example.com", password: PW, ...over18 }),
    });
    const { token } = (await up.json()) as { token: string };
    const userId = store.accounts.findByEmail("prem@example.com")!.userId;
    store.setGradePlan(userId, "premium", now.toISOString());
    expect((await identify(app, token)).status).toBe(200);
    now = new Date("2026-11-01T00:00:00.000Z");
    expect((await identify(app, token)).status).toBe(200);
    const accessBody = (await (await access(app, token)).json()) as { access: { state: string } };
    expect(accessBody.access.state).toBe("premium");
  });

});
