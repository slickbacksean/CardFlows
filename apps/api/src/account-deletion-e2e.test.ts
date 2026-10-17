import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";

/** P4: account deletion end to end, for every kind of session the app can hold. */
const stores: SqliteStorePort[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function open() {
  const store = createSqliteStore({ sqlitePath: ":memory:" });
  stores.push(store);
  return { store, app: createApp(store, { devAutoSession: false, guestMode: true }) };
}

type App = ReturnType<typeof createApp>;
async function call(app: App, path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await app.request(path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const PW = "correct horse battery";
const remaining = (rows: Record<string, number>) => Object.entries(rows).filter(([, n]) => n > 0);

describe("P4 account deletion end to end", () => {
  it("a guest can delete their guest data now (not only after 24 hours)", async () => {
    const { app, store } = open();
    const guest = await call(app, "/v1/sessions/guest", { method: "POST" });
    const token = guest.body.token as string;
    const userId = (guest.body.identity as { userId: string }).userId;
    await call(app, "/v1/scans", { body: { captureMethod: "camera_photo", scenario: "high-confidence" }, token });
    expect(store.accounts.countUserRows(userId).crm_scans).toBe(1);
    const deleted = await call(app, "/v1/account/delete", { method: "POST", token });
    expect(deleted.status).toBe(200);
    expect(deleted.body.ok).toBe(true);
    expect(remaining(store.accounts.countUserRows(userId))).toEqual([]);
    expect((await call(app, "/v1/inventory", { token })).status).toBe(401);
  });

  it("an unverified account can delete itself, and the email is free again afterwards", async () => {
    const { app, store } = open();
    const up = await call(app, "/v1/accounts", { body: { email: "gone@example.com", password: PW } });
    expect(up.status).toBe(200);
    const token = up.body.token as string;
    const userId = (up.body.identity as { userId: string }).userId;
    expect(up.body.emailVerified).toBe(false);
    const deleted = await call(app, "/v1/account/delete", { method: "POST", token });
    expect(deleted.status).toBe(200);
    expect(remaining(store.accounts.countUserRows(userId))).toEqual([]);
    // Signed out everywhere, password gone, email reusable.
    expect((await call(app, "/v1/identity", { token })).status).toBe(401);
    expect((await call(app, "/v1/sessions/password", { body: { email: "gone@example.com", password: PW } })).status).toBe(401);
    const again = await call(app, "/v1/accounts", { body: { email: "gone@example.com", password: PW } });
    expect(again.status).toBe(200);
    expect((again.body.identity as { userId: string }).userId).not.toBe(userId);
  });

  it("every session of the account is signed out, and a repeat delete is refused", async () => {
    const { app } = open();
    const up = await call(app, "/v1/accounts", { body: { email: "two@example.com", password: PW } });
    const first = up.body.token as string;
    const second = (await call(app, "/v1/sessions/password", { body: { email: "two@example.com", password: PW } })).body
      .token as string;
    expect((await call(app, "/v1/account/delete", { method: "POST", token: first })).status).toBe(200);
    expect((await call(app, "/v1/inventory", { token: second })).status).toBe(401);
    expect((await call(app, "/v1/account/delete", { method: "POST", token: first })).status).toBe(401);
  });

  it("without a session there is nothing to delete", async () => {
    const { app } = open();
    expect((await call(app, "/v1/account/delete", { method: "POST" })).status).toBe(401);
  });
});
