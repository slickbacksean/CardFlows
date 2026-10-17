import { afterEach, describe, expect, it } from "vitest";
import { ACCOUNT_AUTH_COPY, USER_PRICE_SOURCE } from "@cardflow/shared";
import { createApp } from "./app";
import { JORDAN_INVITE_CODE, invitedTesters } from "./invited-testers";
import { hashPassword, verifyPassword } from "./password";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";

const stores: SqliteStorePort[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function open(options: Parameters<typeof createApp>[1] = {}) {
  const store = createSqliteStore({ sqlitePath: ":memory:" });
  stores.push(store);
  return { store, app: createApp(store, { devAutoSession: false, guestMode: true, ...options }) };
}

type App = ReturnType<typeof createApp>;
async function call(app: App, path: string, init: { method?: string; body?: unknown; token?: string; ip?: string } = {}) {
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

describe("open sign-up", () => {
  it("hashes passwords with scrypt and verifies them", async () => {
    const hash = await hashPassword(PW);
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash).not.toContain(PW);
    expect(await verifyPassword(PW, hash)).toBe(true);
    expect(await verifyPassword("wrong password!", hash)).toBe(false);
  });

  it("signs up, signs in, and the session works", async () => {
    const { app } = open();
    const up = await call(app, "/v1/accounts", { body: { email: "Sam@Example.com ", password: PW } });
    expect(up.status).toBe(200);
    expect(up.body.identity).toMatchObject({ label: "sam@example.com" });
    const me = await call(app, "/v1/identity", { token: up.body.token as string });
    expect(me.status).toBe(200);
    expect((await call(app, "/v1/inventory", { token: up.body.token as string })).status).toBe(200);
    const signIn = await call(app, "/v1/sessions/password", { body: { email: "sam@example.com", password: PW } });
    expect(signIn.status).toBe(200);
  });

  it("enforces a minimum password and a valid email", async () => {
    const { app } = open();
    expect((await call(app, "/v1/accounts", { body: { email: "a@b.co", password: "short" } })).body.error).toBe(ACCOUNT_AUTH_COPY.badPassword);
    expect((await call(app, "/v1/accounts", { body: { email: "a@b.co", password: "aaaaaaaaaaaa" } })).status).toBe(400);
    expect((await call(app, "/v1/accounts", { body: { email: "not-an-email", password: PW } })).body.error).toBe(ACCOUNT_AUTH_COPY.badEmail);
  });

  it("doesn't reveal which emails exist when signing in", async () => {
    const { app } = open();
    await call(app, "/v1/accounts", { body: { email: "known@example.com", password: PW } });
    const wrongPw = await call(app, "/v1/sessions/password", { body: { email: "known@example.com", password: "nope nope nope" } });
    const unknown = await call(app, "/v1/sessions/password", { body: { email: "nobody@example.com", password: "nope nope nope" } });
    expect(wrongPw).toEqual(unknown);
    expect(wrongPw).toEqual({ status: 401, body: { ok: false, error: ACCOUNT_AUTH_COPY.signInFailed } });
  });

  it("rate-limits per IP and per email", async () => {
    const { app } = open({ authLimits: { signInPerIp: 3, perEmail: 2, signupPerIp: 2 } });
    for (let i = 0; i < 2; i += 1) await call(app, "/v1/sessions/password", { body: { email: "x@example.com", password: "bad password" } });
    expect((await call(app, "/v1/sessions/password", { body: { email: "x@example.com", password: "bad password" } })).status).toBe(429);
    const other = open({ authLimits: { signInPerIp: 2, perEmail: 50 } }).app;
    await call(other, "/v1/sessions/password", { body: { email: "a@example.com", password: "bad password" } });
    await call(other, "/v1/sessions/password", { body: { email: "b@example.com", password: "bad password" } });
    expect((await call(other, "/v1/sessions/password", { body: { email: "c@example.com", password: "bad password" } })).status).toBe(429);
    await call(app, "/v1/accounts", { body: { email: "s1@example.com", password: PW } });
    await call(app, "/v1/accounts", { body: { email: "s2@example.com", password: PW } });
    expect((await call(app, "/v1/accounts", { body: { email: "s3@example.com", password: PW } })).status).toBe(429);
  });

  it("keeps the invite-code path for testers, and codes fail closed without env", async () => {
    const { app } = open();
    expect((await call(app, "/v1/sessions", { body: { inviteCode: JORDAN_INVITE_CODE } })).status).toBe(200);
    expect(invitedTesters({})).toEqual([]);
    expect(invitedTesters({ CARD_FLOW_INVITE_ALEX: "x" })).toHaveLength(1);
  });

  it("account deletion leaves zero rows in every user_id table", async () => {
    const { app, store } = open();
    const guest = (await call(app, "/v1/sessions/guest", { method: "POST" })).body.token as string;
    await call(app, "/v1/scans", { body: { captureMethod: "camera_photo", scenario: "high-confidence" }, token: guest });
    const up = await call(app, "/v1/accounts", { body: { email: "del@example.com", password: PW }, token: guest });
    const userId = (up.body.identity as { userId: string }).userId;
    const token = up.body.token as string;
    const at = "2026-10-15T00:00:00.000Z";
    store.saveConfirmEvent({ scanId: "s1", userId, via: "candidate", shownTcgdexIds: ["base1-58"], chosenTcgdexId: "base1-58", chosenRank: 1, selectedVariant: null, confidence: null, recognitionProvider: null, at } as never);
    store.saveUserPriceSnapshot(userId, { snapshotId: "p1", tcgdexId: "base1-58", variant: null, amount: "1.00", currency: "USD", source: USER_PRICE_SOURCE, enteredAt: at });
    store.sales.save(userId, { inventoryItemId: "i1", priceCents: 100, feesCents: null, soldAt: at, updatedAt: at });
    store.gradeHistory.append(userId, { entryId: "g1", inventoryItemId: "i1", overall: 7, confidence: null, recordedAt: at });
    store.setPreferences?.(userId, {} as never);
    const before = store.accounts.countUserRows(userId);
    expect(before.crm_scans).toBe(1);
    expect(before.scan_confirm_events).toBe(1);
    expect(before.user_price_snapshots).toBe(1);
    expect(before.user_card_sales).toBe(1);
    const deleted = await call(app, "/v1/account/delete", { method: "POST", token });
    expect(deleted.status).toBe(200);
    const after = store.accounts.countUserRows(userId);
    expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
    expect((await call(app, "/v1/inventory", { token })).status).toBe(401);
    expect((await call(app, "/v1/sessions/password", { body: { email: "del@example.com", password: PW } })).status).toBe(401);
  });
});

describe("North Star counts signed-up accounts", () => {
  it("an account's scans count toward weekly active resellers", async () => {
    const { app } = open({ opsToken: "t" });
    const up = await call(app, "/v1/accounts", { body: { email: "ns@example.com", password: PW } });
    const scan = await call(app, "/v1/scans", { body: { captureMethod: "camera_photo" }, token: up.body.token as string });
    expect(scan.status).toBe(201);
    const res = await app.request("/ops/north-star?weeks=1", { headers: { authorization: "Bearer t" } });
    const body = (await res.json()) as { weeks: Array<{ activeResellers: number }> };
    expect(body.weeks.at(-1)?.activeResellers).toBe(1);
  });
});

describe("forgot password", () => {
  it("same answer for known and unknown emails; single-use 1 h token; signs out old sessions", async () => {
    const sent: Array<{ email: string; token: string }> = [];
    let clock = new Date("2026-10-16T12:00:00Z");
    const { app } = open({ deliverPasswordReset: (email, token) => sent.push({ email, token }), now: () => clock });
    const up = await call(app, "/v1/accounts", { body: { email: "reset@example.com", password: PW } });
    const known = await call(app, "/v1/password-resets", { body: { email: "Reset@Example.com" } });
    const unknown = await call(app, "/v1/password-resets", { body: { email: "nobody@example.com" } });
    expect(known).toEqual(unknown);
    expect(known).toEqual({ status: 202, body: { ok: true, message: ACCOUNT_AUTH_COPY.resetRequested } });
    expect(sent).toHaveLength(1);
    const token = sent[0]!.token;
    const NEW = "brand new password 1";
    expect((await call(app, "/v1/password-resets/confirm", { body: { token, password: "short" } })).status).toBe(400);
    const done = await call(app, "/v1/password-resets/confirm", { body: { token, password: NEW } });
    expect(done.status).toBe(200);
    expect((await call(app, "/v1/identity", { token: up.body.token as string })).status).toBe(401);
    expect((await call(app, "/v1/sessions/password", { body: { email: "reset@example.com", password: NEW } })).status).toBe(200);
    expect((await call(app, "/v1/sessions/password", { body: { email: "reset@example.com", password: PW } })).status).toBe(401);
    const reused = await call(app, "/v1/password-resets/confirm", { body: { token, password: "another password 2" } });
    expect(reused).toEqual({ status: 400, body: { ok: false, error: ACCOUNT_AUTH_COPY.resetInvalid } });

    await call(app, "/v1/password-resets", { body: { email: "reset@example.com" } });
    clock = new Date(clock.getTime() + 61 * 60 * 1000);
    expect((await call(app, "/v1/password-resets/confirm", { body: { token: sent[1]!.token, password: "another password 2" } })).status).toBe(400);
  });

  it("a newer reset voids the older code", async () => {
    const sent: string[] = [];
    const { app } = open({ deliverPasswordReset: (_e, token) => sent.push(token) });
    await call(app, "/v1/accounts", { body: { email: "two@example.com", password: PW } });
    await call(app, "/v1/password-resets", { body: { email: "two@example.com" } });
    await call(app, "/v1/password-resets", { body: { email: "two@example.com" } });
    expect((await call(app, "/v1/password-resets/confirm", { body: { token: sent[0], password: "another password 2" } })).status).toBe(400);
    expect((await call(app, "/v1/password-resets/confirm", { body: { token: sent[1], password: "another password 2" } })).status).toBe(200);
  });
});

describe("backend review: auth limits and scrypt", () => {
  it("H1: successful sign-ins don't count; failures are keyed by email + IP", async () => {
    const { app } = open({ authLimits: { signInPerIp: 100, perEmail: 2 } });
    await call(app, "/v1/accounts", { body: { email: "ok@example.com", password: PW } });
    for (let i = 0; i < 5; i += 1) {
      expect((await call(app, "/v1/sessions/password", { body: { email: "ok@example.com", password: PW } })).status).toBe(200);
    }
    for (let i = 0; i < 2; i += 1) await call(app, "/v1/sessions/password", { body: { email: "ok@example.com", password: "wrong password" } });
    expect((await call(app, "/v1/sessions/password", { body: { email: "ok@example.com", password: PW } })).status).toBe(429);
  });

  it("M4: invite-code sign-in is rate-limited per IP", async () => {
    const { app } = open({ authLimits: { invitePerIp: 3 } });
    for (let i = 0; i < 3; i += 1) await call(app, "/v1/sessions", { body: { inviteCode: `guess-${i}` } });
    expect((await call(app, "/v1/sessions", { body: { inviteCode: JORDAN_INVITE_CODE } })).status).toBe(429);
  });

  it("L2: production scrypt is N=2^17 and stored params keep older hashes verifying", async () => {
    const { SCRYPT_DEFAULT_N, scryptN } = await import("./password");
    expect(SCRYPT_DEFAULT_N).toBe(2 ** 17);
    expect(scryptN({ NODE_ENV: "production", CARD_FLOW_SCRYPT_N: "1024" })).toBe(2 ** 17);
    const strong = await hashPassword(PW, 2 ** 17);
    expect(strong.startsWith(`scrypt$${2 ** 17}$8$1$`)).toBe(true);
    expect(await verifyPassword(PW, strong)).toBe(true);
    const old = await hashPassword(PW, 2 ** 14);
    expect(await verifyPassword(PW, old)).toBe(true);
  });
});
