import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { AGE_CONFIRMATION_REQUIRED_CODE, AGE_GATE_COPY, AGE_GATE_VERSION, CARDSIGHT_CONSENT_VERSION } from "@cardflow/shared";
import { createApp } from "./app";
import { ageConfirmations } from "./db/schema";
import { ageGateEnabledFromEnv } from "./grade-quota-env";
import { createSqliteStore } from "./sqlite-store";
import { createMemoryStore, type StorePort } from "./store";

type App = ReturnType<typeof createApp>;
type Body = Record<string, unknown> & { error?: string; token?: string };

async function req(app: App, path: string, init: { method?: string; body?: unknown; token?: string; form?: FormData; headers?: Record<string, string> } = {}) {
  const res = await app.request(path, {
    method: init.method ?? (init.body !== undefined || init.form ? "POST" : "GET"),
    headers: {
      ...(init.form ? {} : { "content-type": "application/json" }),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...init.headers,
    },
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
  return { status: res.status, body: (await res.json()) as Body };
}

function scanForm() {
  const form = new FormData();
  form.append("captureMethod", "camera_photo");
  form.append("image", new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], "still.jpg", { type: "image/jpeg" }));
  return form;
}

const signUp = (email: string, extra: Record<string, unknown> = {}) => ({ email, password: "correct horse battery", ...extra });
const over18 = { ageConfirmed18Plus: true, ageGateVersion: AGE_GATE_VERSION };

describe.each(["memory", "sqlite"] as const)("Sean (Oct 17): 18+ is stated at sign-up only (%s)", (kind) => {
  function open(extra: Record<string, unknown> = {}): { app: App; store: StorePort } {
    const store = kind === "sqlite" ? createSqliteStore({ sqlitePath: ":memory:" }) : createMemoryStore();
    return { app: createApp(store, { devAutoSession: false, guestMode: true, ageGate: true, ...extra }), store };
  }

  it("sign-up without the checkbox is refused; with it only age_attested_at + version are stored", async () => {
    const { app, store } = open({ now: () => new Date("2026-10-17T15:30:00.000Z") });
    const refused = await req(app, "/v1/accounts", { body: signUp("no@example.com") });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: AGE_CONFIRMATION_REQUIRED_CODE, message: AGE_GATE_COPY.required });
    expect(store.accounts.findByEmail("no@example.com")).toBeNull();
    expect((await req(app, "/v1/accounts", { body: signUp("f@example.com", { ageConfirmed18Plus: false, ageGateVersion: AGE_GATE_VERSION }) })).status).toBe(400);
    expect((await req(app, "/v1/accounts", { body: signUp("old@example.com", { ageConfirmed18Plus: true, ageGateVersion: "old" }) })).status).toBe(400);

    const up = await req(app, "/v1/accounts", { body: signUp("adult@example.com", over18) });
    expect(up.status).toBe(200);
    const userId = store.accounts.findByEmail("adult@example.com")!.userId;
    expect(store.ageConfirmations.get(userId)).toEqual({ ageConfirmed18Plus: true, ageAttestedAt: "2026-10-17T15:30:00.000Z", version: AGE_GATE_VERSION });
    expect((await req(app, "/v1/age-confirmation", { token: up.body.token })).body.age).toEqual({
      confirmed: true,
      version: AGE_GATE_VERSION,
      attestedAt: "2026-10-17T15:30:00.000Z",
      currentVersion: AGE_GATE_VERSION,
    });
  });

  it("scans and uploads no longer need an age statement (guests and accounts)", async () => {
    const { app, store } = open();
    const guest = (await req(app, "/v1/sessions/guest", { method: "POST" })).body.token as string;
    expect((await req(app, "/v1/scans", { form: scanForm(), token: guest })).status).toBe(201);
    const up = await req(app, "/v1/accounts", { body: signUp("tester@example.com", over18) });
    store.ageConfirmations.deleteUser(store.accounts.findByEmail("tester@example.com")!.userId);
    expect((await req(app, "/v1/scans", { form: scanForm(), token: up.body.token })).status).toBe(201);
    // No age route for guests, no age gate screen route.
    expect((await req(app, "/v1/age-confirmation", { body: { ageConfirmed18Plus: true, version: AGE_GATE_VERSION }, token: guest })).status).toBe(403);
  });

  it("ops under-18 report: CardSight off, sessions ended, account and data deleted", async () => {
    const { app, store } = open({ opsToken: "ops-secret" });
    const up = await req(app, "/v1/accounts", { body: signUp("teen@example.com", over18) });
    const token = up.body.token as string;
    await req(app, "/v1/consents/cardsight", { body: { granted: true, version: CARDSIGHT_CONSENT_VERSION }, token });
    expect((await req(app, "/v1/scans", { form: scanForm(), token })).status).toBe(201);
    const userId = store.accounts.findByEmail("teen@example.com")!.userId;

    expect((await req(app, "/ops/under-18-report", { body: { email: "teen@example.com" } })).status).toBe(401);
    expect((await req(app, "/ops/under-18-report", { body: { email: "teen@example.com" }, token: "wrong" })).status).toBe(401);
    expect((await req(app, "/ops/under-18-report", { body: { email: "nobody@example.com" }, token: "ops-secret" })).status).toBe(404);

    const done = await req(app, "/ops/under-18-report", { body: { email: "TEEN@example.com" }, token: "ops-secret" });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ ok: true, cardSightOff: true });
    expect(done.body.rowsDeleted).toEqual(expect.any(Number));
    expect(store.accounts.findByEmail("teen@example.com")).toBeNull();
    expect(store.consents.get(userId, "cardsight")).toBeNull();
    expect(store.ageConfirmations.get(userId)).toBeNull();
    expect(store.listScans(userId)).toHaveLength(0);
    expect((await req(app, "/v1/identity", { token })).status).toBe(401);
  });
});

describe("age statement storage and config", () => {
  it("the table has no birth-date column", () => {
    expect(getTableConfig(ageConfirmations).columns.map((c) => c.name).sort()).toEqual([
      "age_attested_at",
      "age_confirmed_18plus",
      "user_id",
      "version",
    ]);
  });

  it("the under-18 report route is hidden when no ops token is set", async () => {
    const app = createApp(createMemoryStore(), { opsToken: null });
    expect((await req(app, "/ops/under-18-report", { body: { email: "x@example.com" }, token: "anything" })).status).toBe(404);
  });

  it("the sign-up check is always on outside tests and can't be turned off in production", () => {
    expect(ageGateEnabledFromEnv({})).toBe(true);
    expect(ageGateEnabledFromEnv({ NODE_ENV: "production", CARD_FLOW_AGE_GATE: "off" })).toBe(true);
    expect(ageGateEnabledFromEnv({ VITEST: "true" })).toBe(false);
    expect(ageGateEnabledFromEnv({ VITEST: "true", CARD_FLOW_AGE_GATE: "on" })).toBe(true);
  });
});
