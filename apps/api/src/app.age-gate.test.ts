import { describe, expect, it } from "vitest";
import {
  AGE_CONFIRMATION_REQUIRED_CODE,
  AGE_GATE_COPY,
  AGE_GATE_VERSION,
  DEFAULT_INVITED_USER_ID,
} from "@cardflow/shared";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { createApp, requiresAgeConfirmation } from "./app";
import { ageConfirmations } from "./db/schema";
import { ageGateEnabledFromEnv } from "./grade-quota-env";
import { createSqliteStore } from "./sqlite-store";
import { createMemoryStore, type StorePort } from "./store";

type App = ReturnType<typeof createApp>;
type Body = Record<string, unknown> & { age?: Record<string, unknown>; error?: string; token?: string };

async function req(app: App, path: string, init: { method?: string; body?: unknown; token?: string; form?: FormData } = {}) {
  const res = await app.request(path, {
    method: init.method ?? (init.body !== undefined || init.form ? "POST" : "GET"),
    headers: {
      ...(init.form ? {} : { "content-type": "application/json" }),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
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

const confirmBody = { ageConfirmed18Plus: true, version: AGE_GATE_VERSION };
const signUp = (email: string, extra: Record<string, unknown> = {}) => ({ email, password: "correct horse battery", ...extra });
const ageBody = { ageConfirmed18Plus: true, ageGateVersion: AGE_GATE_VERSION };

describe("Sean: 18+ only. The server refuses scans and photo uploads without age confirmation", () => {
  it("every photo/scan route answers 403 age_confirmation_required until the user confirms", async () => {
    const app = createApp(createMemoryStore(), { ageGate: true });
    const paths = [
      "/v1/scans",
      "/v1/livestream/identify",
      "/v1/grade/detect",
      "/v1/grade/pregrade",
      "/v1/grading/batch",
      "/v1/inventory/inv-1/grade-jobs",
      "/v1/inventory/inv-1/grade-estimate",
    ];
    for (const path of paths) {
      expect(requiresAgeConfirmation(path)).toBe(true);
      const res = await req(app, path, path === "/v1/scans" ? { form: scanForm() } : { body: {} });
      expect(res.status, path).toBe(403);
      expect(res.body).toMatchObject({ error: AGE_CONFIRMATION_REQUIRED_CODE, message: AGE_GATE_COPY.required });
    }
    // Reads and non-photo writes are not gated.
    expect(requiresAgeConfirmation("/v1/preferences")).toBe(false);
    expect((await req(app, "/v1/identity")).status).toBe(200);

    expect((await req(app, "/v1/age-confirmation", { body: confirmBody })).status).toBe(200);
    expect((await req(app, "/v1/scans", { form: scanForm() })).status).toBe(201);
  });

  it("stores only the confirmation, its time and the gate version; never a birth date", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    const app = createApp(store, { ageGate: true, now: () => new Date("2026-10-17T05:00:00.000Z") });
    expect((await req(app, "/v1/age-confirmation")).body.age).toEqual({
      confirmed: false,
      version: null,
      confirmedAt: null,
      currentVersion: AGE_GATE_VERSION,
    });
    for (const bad of [
      { ...confirmBody, birthYear: 1990 },
      { ...confirmBody, birthMonth: 4 },
      { ...confirmBody, dob: "1990-04" },
    ]) {
      expect((await req(app, "/v1/age-confirmation", { body: bad })).status).toBe(400);
    }
    expect((await req(app, "/v1/age-confirmation", { body: { ageConfirmed18Plus: false, version: AGE_GATE_VERSION } })).status).toBe(400);
    expect((await req(app, "/v1/age-confirmation", { body: { ageConfirmed18Plus: true, version: "old" } })).status).toBe(409);
    const ok = await req(app, "/v1/age-confirmation", { body: confirmBody });
    expect(ok.body.age).toEqual({ confirmed: true, version: AGE_GATE_VERSION, confirmedAt: "2026-10-17T05:00:00.000Z", currentVersion: AGE_GATE_VERSION });

    expect(store.ageConfirmations.get(DEFAULT_INVITED_USER_ID)).toEqual({
      ageConfirmed18Plus: true,
      confirmedAt: "2026-10-17T05:00:00.000Z",
      version: AGE_GATE_VERSION,
    });
  });

  it("the table has no birth-date column", () => {
    expect(getTableConfig(ageConfirmations).columns.map((c) => c.name).sort()).toEqual([
      "age_confirmed_18plus",
      "confirmed_at",
      "user_id",
      "version",
    ]);
  });

  it("a confirmation for an older gate version doesn't count (asked again)", async () => {
    const store = createMemoryStore();
    store.ageConfirmations.confirm(DEFAULT_INVITED_USER_ID, "2020-01-01", "2020-01-01T00:00:00.000Z");
    const app = createApp(store, { ageGate: true });
    expect((await req(app, "/v1/age-confirmation")).body.age).toMatchObject({ confirmed: false, version: "2020-01-01" });
    expect((await req(app, "/v1/scans", { form: scanForm() })).status).toBe(403);
  });

  it("is always on outside tests and can't be turned off in production", () => {
    expect(ageGateEnabledFromEnv({})).toBe(true);
    expect(ageGateEnabledFromEnv({ NODE_ENV: "production", CARD_FLOW_AGE_GATE: "off" })).toBe(true);
    expect(ageGateEnabledFromEnv({ VITEST: "true" })).toBe(false);
    expect(ageGateEnabledFromEnv({ VITEST: "true", CARD_FLOW_AGE_GATE: "on" })).toBe(true);
  });
});

describe.each(["memory", "sqlite"] as const)("age confirmation at sign-up and for guests (%s)", (kind) => {
  function open(): { app: App; store: StorePort } {
    const store = kind === "sqlite" ? createSqliteStore({ sqlitePath: ":memory:" }) : createMemoryStore();
    return { app: createApp(store, { devAutoSession: false, guestMode: true, ageGate: true }), store };
  }

  it("sign-up without the 18+ confirmation is refused; with it the account is confirmed", async () => {
    const { app, store } = open();
    const refused = await req(app, "/v1/accounts", { body: signUp("no@example.com") });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe(AGE_CONFIRMATION_REQUIRED_CODE);
    expect(store.accounts.findByEmail("no@example.com")).toBeNull();
    expect((await req(app, "/v1/accounts", { body: signUp("old@example.com", { ageConfirmed18Plus: true, ageGateVersion: "old" }) })).status).toBe(403);

    const up = await req(app, "/v1/accounts", { body: signUp("adult@example.com", ageBody) });
    expect(up.status).toBe(200);
    expect((await req(app, "/v1/age-confirmation", { token: up.body.token })).body.age).toMatchObject({ confirmed: true, version: AGE_GATE_VERSION });
    expect((await req(app, "/v1/scans", { form: scanForm(), token: up.body.token })).status).toBe(201);
  });

  it("a guest must confirm before the first scan; the confirmation carries over at sign-up", async () => {
    const { app } = open();
    const guest = (await req(app, "/v1/sessions/guest", { method: "POST" })).body.token as string;
    expect((await req(app, "/v1/scans", { form: scanForm(), token: guest })).status).toBe(403);
    const confirmed = await req(app, "/v1/age-confirmation", { body: confirmBody, token: guest });
    expect(confirmed.status).toBe(200);
    expect((await req(app, "/v1/scans", { form: scanForm(), token: guest })).status).toBe(201);

    // No age fields in the body: the guest's confirmation is enough, and it moves to the account.
    const up = await req(app, "/v1/accounts", { body: signUp("guest@example.com"), token: guest });
    expect(up.status).toBe(200);
    expect((await req(app, "/v1/age-confirmation", { token: up.body.token })).body.age).toMatchObject({
      confirmed: true,
      confirmedAt: (confirmed.body.age as { confirmedAt: string }).confirmedAt,
    });
  });

  it("is deleted with the account, and a guest can delete their own guest data", async () => {
    const { app, store } = open();
    const up = await req(app, "/v1/accounts", { body: signUp("bye@example.com", ageBody) });
    const userId = store.accounts.findByEmail("bye@example.com")!.userId;
    expect(store.ageConfirmations.get(userId)).not.toBeNull();
    expect((await req(app, "/v1/account/delete", { method: "POST", token: up.body.token })).status).toBe(200);
    expect(store.ageConfirmations.get(userId)).toBeNull();

    const guest = (await req(app, "/v1/sessions/guest", { method: "POST" })).body.token as string;
    await req(app, "/v1/age-confirmation", { body: confirmBody, token: guest });
    const guestId = ((await req(app, "/v1/identity", { token: guest })).body.identity as { userId: string }).userId;
    expect(store.ageConfirmations.get(guestId)).not.toBeNull();
    expect((await req(app, "/v1/account/delete", { method: "POST", token: guest })).status).toBe(200);
    expect(store.ageConfirmations.get(guestId)).toBeNull();
  });
});
