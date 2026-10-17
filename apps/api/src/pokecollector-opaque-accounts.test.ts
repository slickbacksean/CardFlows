import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { INVITED_USERS } from "@cardflow/shared";
import { createApp } from "./app";
import { ALEX_INVITE_CODE, JORDAN_INVITE_CODE } from "./invited-testers";
import {
  createMockPokecollectorAccounts,
  createPokecollectorAccounts,
  isReadyLink,
  MOCK_POKECOLLECTOR_SECRETS,
  type PokecollectorUserMapping,
} from "./pokecollector-accounts";
import { createPokecollectorAccountsFromEnv } from "./pokecollector-env";
import {
  decryptLinkPassword,
  isOpaquePokecollectorUsername,
  opaquePokecollectorUsername,
  pokecollectorLinkSecretsFromEnv,
} from "./pokecollector-link-secrets";
import { planPokecollectorRelink, runPokecollectorRelink } from "./pokecollector-relink";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const stores: SqliteStorePort[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type App = ReturnType<typeof createApp>;
async function call(app: App, url: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await app.request(url, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
function open(extra: Parameters<typeof createApp>[1] = {}, sqlitePath = ":memory:") {
  const store = createSqliteStore({ sqlitePath });
  stores.push(store);
  return { store, app: createApp(store, { devAutoSession: false, guestMode: true, ...extra }) };
}
async function signUp(app: App, email: string) {
  const up = await call(app, "/v1/accounts", { body: { email, password: "correct horse battery", ageConfirmed18Plus: true } });
  expect(up.status).toBe(200);
  return { token: up.body.token as string, userId: (up.body.identity as { userId: string }).userId };
}
async function purchase(app: App, token: string, tcgdexId: string, intent: "purchased" | "watchlist" = "purchased") {
  const scan = await call(app, "/v1/scans", { body: { captureMethod: "camera_photo", scenario: "high-confidence" }, token });
  const scanId = (scan.body.scan as { scanId: string }).scanId;
  const confirmed = await call(app, `/v1/scans/${scanId}/confirm`, { body: { tcgdexId }, token });
  const confirmationId = (confirmed.body.confirmation as { confirmationId: string }).confirmationId;
  const res = await call(app, `/v1/inventory/${intent}`, {
    body: intent === "purchased" ? { confirmationId, purchasePrice: "5", purchasedAt: new Date().toISOString() } : { confirmationId },
    token,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

describe("opaque per-user PokéCollector accounts", () => {
  it("usernames are cardflow-u-<base32(HMAC-SHA256(userId, pepper))[:20]>, never from the email or label", () => {
    const pepper = MOCK_POKECOLLECTOR_SECRETS.userPepper;
    const name = opaquePokecollectorUsername("acct_123", pepper);
    expect(name).toMatch(/^cardflow-u-[a-z2-7]{20}$/);
    expect(isOpaquePokecollectorUsername(name)).toBe(true);
    expect(opaquePokecollectorUsername("acct_123", pepper)).toBe(name);
    expect(opaquePokecollectorUsername("acct_124", pepper)).not.toBe(name);
    expect(opaquePokecollectorUsername("acct_123", `${pepper}-other`)).not.toBe(name);
    expect(isOpaquePokecollectorUsername("cardflow-sean")).toBe(false);
    expect(isOpaquePokecollectorUsername("cardflow-guest")).toBe(false);
  });

  for (const [a, b] of [
    ["sean@gmail.com", "sean@yahoo.com"],
    ["sean.h@example.com", "sean_h@example.com"],
  ] as const) {
    it(`${a} and ${b} get separate remote users (used to collide)`, async () => {
      const accounts = createMockPokecollectorAccounts();
      const { app, store } = open({ pokecollectorAccounts: accounts });
      const first = await signUp(app, a);
      const second = await signUp(app, b);
      await call(app, "/v1/identity", { token: first.token });
      await call(app, "/v1/identity", { token: second.token });
      const m1 = store.getPokecollectorUserMapping(first.userId)!;
      const m2 = store.getPokecollectorUserMapping(second.userId)!;
      expect(isReadyLink(m1) && isReadyLink(m2)).toBe(true);
      expect(m1.pokecollectorUserId).not.toBe(m2.pokecollectorUserId);
      expect(m1.pokecollectorUsername).not.toBe(m2.pokecollectorUsername);
      for (const m of [m1, m2]) expect(m.pokecollectorUsername).not.toMatch(/sean/);
      expect(accounts.remoteUsers.size).toBe(2);
      // Each one's cards land only in their own remote collection.
      await purchase(app, first.token, "base1-58");
      expect((await accounts.listCollection(m1)).map((c) => c.tcgdexId)).toEqual(["base1-58"]);
      expect(await accounts.listCollection(m2)).toEqual([]);
    });
  }

  it("guests are never bound (no shared cardflow-guest)", async () => {
    const accounts = createMockPokecollectorAccounts();
    const { app, store } = open({ pokecollectorAccounts: accounts });
    const guests = [];
    for (let i = 0; i < 2; i += 1) {
      const guest = await call(app, "/v1/sessions/guest", { method: "POST" });
      guests.push({ token: guest.body.token as string, userId: (guest.body.identity as { userId: string }).userId });
    }
    for (const g of guests) {
      expect((await call(app, "/v1/identity", { token: g.token })).status).toBe(200);
      expect(store.getPokecollectorUserMapping(g.userId)).toBeUndefined();
    }
    // Guest scans and collection reads never create a remote user either.
    expect((await call(app, "/v1/scans", { body: { captureMethod: "camera_photo", scenario: "high-confidence" }, token: guests[0]!.token })).status).toBe(201);
    expect((await call(app, "/v1/collection", { token: guests[0]!.token })).status).toBe(200);
    expect((await call(app, "/v1/inventory", { token: guests[1]!.token })).status).toBe(200);
    expect(store.getPokecollectorUserMapping(guests[0]!.userId)).toBeUndefined();
    expect(accounts.remoteUsers.size).toBe(0);
  });

  it("each link has its own random password, stored only encrypted (bound to the user)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-pc-"));
    dirs.push(dir);
    const sqlitePath = path.join(dir, "db.sqlite");
    const accounts = createMockPokecollectorAccounts();
    const { app, store } = open({ pokecollectorAccounts: accounts }, sqlitePath);
    await call(app, "/v1/sessions", { body: { inviteCode: ALEX_INVITE_CODE } });
    await call(app, "/v1/sessions", { body: { inviteCode: JORDAN_INVITE_CODE } });
    const alex = store.getPokecollectorUserMapping(INVITED_USERS[0].userId)!;
    const jordan = store.getPokecollectorUserMapping(INVITED_USERS[1].userId)!;
    const key = MOCK_POKECOLLECTOR_SECRETS.linkKey;
    const alexPassword = decryptLinkPassword(alex.passwordCiphertext!, alex.userId, key);
    const jordanPassword = decryptLinkPassword(jordan.passwordCiphertext!, jordan.userId, key);
    expect(alexPassword).toMatch(/^cf-[A-Za-z0-9_-]{32}$/);
    expect(alexPassword).not.toBe(jordanPassword);
    // A ciphertext copied to another user doesn't decrypt.
    expect(() => decryptLinkPassword(alex.passwordCiphertext!, jordan.userId, key)).toThrow();
    const raw = new Database(sqlitePath, { readonly: true });
    try {
      const dump = JSON.stringify(raw.prepare("SELECT * FROM crm_pokecollector_users").all());
      expect(dump).not.toContain(alexPassword);
      expect(dump).not.toContain(jordanPassword);
    } finally {
      raw.close();
    }
  });
});

describe("real adapter: always create, never look up by name", () => {
  const secrets = { userPepper: "real-adapter-test-pepper-0123456789abcdef", linkKey: Buffer.alloc(32, 9) };
  function fake(existing: Record<string, { id: number; password: string }> = {}) {
    const calls: string[] = [];
    const users = new Map(Object.entries(existing));
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init.method ?? "GET").toUpperCase();
      calls.push(`${method} ${url.pathname}`);
      const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      if (url.pathname === "/api/auth/users" && method === "POST") {
        const body = JSON.parse(String(init.body)) as { username: string; password: string };
        if (users.has(body.username)) return reply(400, { detail: "Username already exists" });
        const id = users.size + 100;
        users.set(body.username, { id, password: body.password });
        return reply(200, { id, username: body.username, role: "trainer" });
      }
      if (url.pathname === "/api/auth/login" && method === "POST") {
        const form = new URLSearchParams(String(init.body));
        const user = users.get(form.get("username") ?? "");
        if (!user || user.password !== form.get("password")) return reply(401, { detail: "Incorrect username or password" });
        return reply(200, { access_token: `jwt-${user.id}`, user: { id: user.id } });
      }
      return reply(404, {});
    };
    return { calls, users, fetchImpl };
  }
  const build = (f: ReturnType<typeof fake>) =>
    createPokecollectorAccounts({ baseUrl: "http://pc.test", token: "admin", secrets, fetchImpl: f.fetchImpl, maxRetries: 0 });

  it("creates the remote user with POST and never lists users", async () => {
    const f = fake();
    const accounts = build(f);
    const linked = await accounts.completeLink(accounts.newPendingLink("acct_a")!);
    expect(linked?.pokecollectorUserId).toBe("100");
    expect(f.calls).toEqual(["POST /api/auth/users"]);
  });

  it("a duplicate name is ours only if this link's password signs in (a create we didn't save)", async () => {
    const f = fake();
    const accounts = build(f);
    const pending = accounts.newPendingLink("acct_b")!;
    await accounts.completeLink(pending);
    // Same pending row again (as after a crash): 400, then sign-in with our own password.
    const again = await accounts.completeLink(pending);
    expect(again?.pokecollectorUserId).toBe("100");
    expect(f.calls).toEqual(["POST /api/auth/users", "POST /api/auth/users", "POST /api/auth/login"]);
  });

  it("someone else's user under that name is never bound (fail closed)", async () => {
    const username = opaquePokecollectorUsername("acct_c", secrets.userPepper);
    const f = fake({ [username]: { id: 7, password: "someone-elses-password" } });
    const accounts = build(f);
    expect(await accounts.completeLink(accounts.newPendingLink("acct_c")!)).toBeNull();
    expect(f.calls).not.toContain("GET /api/auth/users");
  });
});

describe("fail closed without the pepper or key (no fallbacks)", () => {
  const base = {
    VITEST: "false",
    NODE_ENV: "production",
    CARD_FLOW_POKECOLLECTOR_URL: "http://pc.test",
    CARD_FLOW_POKECOLLECTOR_TOKEN: "admin-token",
    CARD_FLOW_POKECOLLECTOR_USER_PEPPER: "p".repeat(40),
    CARD_FLOW_POKECOLLECTOR_LINK_KEY: Buffer.alloc(32, 1).toString("base64"),
  };
  it("accounts are on only with the admin token, user pepper and link key", () => {
    expect(createPokecollectorAccountsFromEnv(base).accounts.name).toBe("pokecollector");
    for (const missing of ["CARD_FLOW_POKECOLLECTOR_USER_PEPPER", "CARD_FLOW_POKECOLLECTOR_LINK_KEY", "CARD_FLOW_POKECOLLECTOR_TOKEN"] as const) {
      const { accounts, selection } = createPokecollectorAccountsFromEnv({ ...base, [missing]: "" });
      expect(accounts.name, missing).toBe("off");
      expect(selection.reason, missing).toContain("fail closed");
    }
    expect(createPokecollectorAccountsFromEnv({ ...base, CARD_FLOW_POKECOLLECTOR_USER_PEPPER: "short" }).accounts.name).toBe("off");
    expect(createPokecollectorAccountsFromEnv({ ...base, CARD_FLOW_POKECOLLECTOR_LINK_KEY: "not-a-key" }).accounts.name).toBe("off");
    expect(createPokecollectorAccountsFromEnv({ ...base, CARD_FLOW_POKECOLLECTOR_ACCOUNTS: "false" }).accounts.name).toBe("off");
    expect(pokecollectorLinkSecretsFromEnv({ ...base, CARD_FLOW_POKECOLLECTOR_LINK_KEY: "ab".repeat(32) }).secrets?.linkKey.length).toBe(32);
  });

  it("the adapter itself refuses to start without them", () => {
    const http = { baseUrl: "http://pc.test", token: "admin" };
    expect(() => createPokecollectorAccounts({ ...http, secrets: { userPepper: "", linkKey: Buffer.alloc(32) } })).toThrow(/USER_PEPPER/);
    expect(() => createPokecollectorAccounts({ ...http, secrets: { userPepper: "p".repeat(40), linkKey: Buffer.alloc(0) } })).toThrow(/LINK_KEY/);
    expect(() => createPokecollectorAccounts({ baseUrl: "http://pc.test", token: null, secrets: MOCK_POKECOLLECTOR_SECRETS })).toThrow(/TOKEN/);
  });

  it("no admin-token or cardflow-local pepper fallback is left in the source", () => {
    const src = readFileSync(path.join(srcDir, "pokecollector-accounts.ts"), "utf8");
    expect(src).not.toContain("cardflow-local");
    expect(src).not.toMatch(/passwordPepper|options\.token \?\? ""|pokecollectorPasswordForUsername|findUserByUsername/);
  });
});

describe("relink script (dry run by default; never run against a real server here)", () => {
  async function legacyWorld() {
    const { app, store } = open();
    const alex = await call(app, "/v1/sessions", { body: { inviteCode: ALEX_INVITE_CODE } });
    const jordan = await call(app, "/v1/sessions", { body: { inviteCode: JORDAN_INVITE_CODE } });
    await purchase(app, alex.body.token as string, "base1-58");
    await purchase(app, alex.body.token as string, "base1-4", "watchlist");
    await purchase(app, jordan.body.token as string, "swsh3-136");
    // Legacy rows as main used to write them: email-derived names, no ciphertext. SQLite's unique
    // constraint kept them on separate remote IDs, but both are legacy and get relinked.
    const legacy = (userId: string, id: string, name: string): PokecollectorUserMapping => ({
      userId, pokecollectorUserId: id, pokecollectorUsername: name, updatedAt: "2026-10-01T00:00:00.000Z", passwordCiphertext: null,
    });
    store.savePokecollectorUserMapping(legacy(INVITED_USERS[0].userId, "41", "cardflow-alex"));
    store.savePokecollectorUserMapping(legacy(INVITED_USERS[1].userId, "42", "cardflow-jordan"));
    store.savePokecollectorUserMapping(legacy("guest_00000000-0000-4000-8000-000000000000", "43", "cardflow-guest"));
    return { store };
  }

  it("dry run: plans the relink and freezes, with no network call and no write", async () => {
    const { store } = await legacyWorld();
    let networkCalls = 0;
    const accounts = createPokecollectorAccounts({
      baseUrl: "http://pc.test",
      token: "admin",
      secrets: MOCK_POKECOLLECTOR_SECRETS,
      fetchImpl: async () => {
        networkCalls += 1;
        return new Response("{}");
      },
    });
    const before = JSON.stringify(store.listPokecollectorUserMappings());
    const result = await runPokecollectorRelink({ store, accounts, dryRun: true });
    expect(networkCalls).toBe(0);
    expect(JSON.stringify(store.listPokecollectorUserMappings())).toBe(before);
    expect(result.plan.freeze.map((f) => f.pokecollectorUserId).sort()).toEqual(["41", "42", "43"]);
    expect(result.plan.relink.map((r) => [r.userId, r.purchased, r.watchlist]).sort()).toEqual(
      [[INVITED_USERS[0].userId, 1, 1], [INVITED_USERS[1].userId, 1, 0]].sort(),
    );
    expect(result.plan.dropGuestLinks).toEqual(["guest_00000000-0000-4000-8000-000000000000"]);
    expect(planPokecollectorRelink(store)).toEqual(result.plan);
  });

  it("apply (mock PokéCollector only): fresh opaque users rebuilt from CardFlow inventory, old users frozen", async () => {
    const { store } = await legacyWorld();
    const accounts = createMockPokecollectorAccounts();
    const frozen: string[] = [];
    accounts.freezeRemoteUser = async (id) => {
      frozen.push(id);
      return true;
    };
    const result = await runPokecollectorRelink({ store, accounts, dryRun: false });
    expect(result.relinked).toBe(2);
    expect(result.copiesWritten).toBe(3);
    expect(result.guestLinksDropped).toBe(1);
    expect(frozen.sort()).toEqual(["41", "42", "43"]);
    const alex = store.getPokecollectorUserMapping(INVITED_USERS[0].userId)!;
    const jordan = store.getPokecollectorUserMapping(INVITED_USERS[1].userId)!;
    expect(isReadyLink(alex) && isReadyLink(jordan)).toBe(true);
    expect(alex.pokecollectorUserId).not.toBe(jordan.pokecollectorUserId);
    expect((await accounts.listCollection(alex)).map((c) => c.tcgdexId)).toEqual(["base1-58"]);
    expect((await accounts.listWishlist(alex)).map((c) => c.tcgdexId)).toEqual(["base1-4"]);
    expect((await accounts.listCollection(jordan)).map((c) => c.tcgdexId)).toEqual(["swsh3-136"]);
    expect(store.getPokecollectorUserMapping("guest_00000000-0000-4000-8000-000000000000")).toBeUndefined();
    // Running it again finds nothing left to do.
    expect(planPokecollectorRelink(store)).toEqual({ freeze: [], relink: [], dropGuestLinks: [] });
  });
});
