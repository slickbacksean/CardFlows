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
  encryptLinkPassword,
  isOpaquePokecollectorUsername,
  linkCiphertextNeedsRotation,
  linkKeyId,
  MIN_LINK_PAYLOAD_BYTES,
  opaquePokecollectorUsername,
  pokecollectorLinkSecretsFromEnv,
  reencryptLinkPassword,
} from "./pokecollector-link-secrets";
import { createCipheriv, randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import {
  fileRelinkState,
  hashRelinkId,
  memoryRelinkState,
  planPokecollectorRelink,
  runPokecollectorRelink,
  summarizeRelink,
  writePrivateJson,
} from "./pokecollector-relink";
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

describe("link ciphertext (Backend re-review L2)", () => {
  const keyA = Buffer.alloc(32, 1);
  const keyB = Buffer.alloc(32, 2);
  it("v2 carries a key ID, so a rotated key still reads old links", () => {
    const ct = encryptLinkPassword("cf-secret", "acct_1", keyA);
    const [version, kid, payload] = ct.split(":");
    expect(version).toBe("v2");
    expect(kid).toBe(linkKeyId(keyA));
    expect(Buffer.from(payload!, "base64url").length).toBeGreaterThanOrEqual(MIN_LINK_PAYLOAD_BYTES);
    // Rotation: B is current, A is previous.
    expect(decryptLinkPassword(ct, "acct_1", [keyB, keyA])).toBe("cf-secret");
    expect(() => decryptLinkPassword(ct, "acct_1", [keyB])).toThrow(/not configured/);
    expect(linkCiphertextNeedsRotation(ct, keyB)).toBe(true);
    const rotated = reencryptLinkPassword(ct, "acct_1", { userPepper: "p".repeat(40), linkKey: keyB, previousLinkKeys: [keyA] });
    expect(rotated.split(":")[1]).toBe(linkKeyId(keyB));
    expect(linkCiphertextNeedsRotation(rotated, keyB)).toBe(false);
    expect(decryptLinkPassword(rotated, "acct_1", keyB)).toBe("cf-secret");
  });

  it("still reads v1 (no key ID), with any configured key", () => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keyA, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from("cardflow-pokecollector-link\0acct_1", "utf8"));
    const body = Buffer.concat([cipher.update("cf-old", "utf8"), cipher.final()]);
    const v1 = `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
    expect(decryptLinkPassword(v1, "acct_1", [keyB, keyA])).toBe("cf-old");
    expect(linkCiphertextNeedsRotation(v1, keyA)).toBe(true);
  });

  it("rejects payloads under 28 bytes (iv + 16-byte tag) and truncated tags", () => {
    const ct = encryptLinkPassword("cf-secret", "acct_1", keyA);
    const [v, kid, payload] = ct.split(":");
    const raw = Buffer.from(payload!, "base64url");
    expect(() => decryptLinkPassword(`${v}:${kid}:${raw.subarray(0, 27).toString("base64url")}`, "acct_1", keyA)).toThrow(/too short/);
    expect(() => decryptLinkPassword(`v1:${raw.subarray(0, 20).toString("base64url")}`, "acct_1", keyA)).toThrow(/too short/);
    // A changed byte in the tag fails authentication.
    const tampered = Buffer.from(raw);
    tampered[20] = tampered[20]! ^ 1;
    expect(() => decryptLinkPassword(`${v}:${kid}:${tampered.toString("base64url")}`, "acct_1", keyA)).toThrow();
  });

  it("previous keys come from CARD_FLOW_POKECOLLECTOR_PREVIOUS_LINK_KEYS", () => {
    const env = {
      CARD_FLOW_POKECOLLECTOR_USER_PEPPER: "p".repeat(40),
      CARD_FLOW_POKECOLLECTOR_LINK_KEY: keyB.toString("base64"),
      CARD_FLOW_POKECOLLECTOR_PREVIOUS_LINK_KEYS: `${keyA.toString("hex")}, ${Buffer.alloc(32, 3).toString("base64")}`,
    };
    expect(pokecollectorLinkSecretsFromEnv(env).secrets?.previousLinkKeys).toHaveLength(2);
    expect(pokecollectorLinkSecretsFromEnv({ ...env, CARD_FLOW_POKECOLLECTOR_PREVIOUS_LINK_KEYS: "nope" }).secrets).toBeNull();
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
    CARD_FLOW_POKECOLLECTOR_ACCOUNTS: "true",
  };
  it("M3: accounts stay off unless CARD_FLOW_POKECOLLECTOR_ACCOUNTS=true", () => {
    for (const flag of [undefined, "", "1", "yes", "on", "TRUE ", "false"]) {
      const env = { ...base, CARD_FLOW_POKECOLLECTOR_ACCOUNTS: flag };
      const expected = flag?.trim().toLowerCase() === "true" ? "pokecollector" : "off";
      expect(createPokecollectorAccountsFromEnv(env).accounts.name, String(flag)).toBe(expected);
    }
  });

  it("M2: the admin's credentials can stand in for the token (minted at first use, again on a 401)", () => {
    const env = {
      ...base,
      CARD_FLOW_POKECOLLECTOR_TOKEN: "",
      CARD_FLOW_POKECOLLECTOR_ADMIN_USERNAME: "admin",
      CARD_FLOW_POKECOLLECTOR_ADMIN_PASSWORD: "admin-password",
    };
    expect(createPokecollectorAccountsFromEnv(env).accounts.name).toBe("pokecollector");
  });

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
  const GUEST = "guest_00000000-0000-4000-8000-000000000000";
  async function legacyWorld() {
    const { app, store } = open();
    const alex = await call(app, "/v1/sessions", { body: { inviteCode: ALEX_INVITE_CODE } });
    const jordan = await call(app, "/v1/sessions", { body: { inviteCode: JORDAN_INVITE_CODE } });
    await purchase(app, alex.body.token as string, "base1-58");
    await purchase(app, alex.body.token as string, "swsh3-136");
    await purchase(app, alex.body.token as string, "base1-4", "watchlist");
    await purchase(app, jordan.body.token as string, "swsh3-136");
    // Legacy rows as main used to write them: email-derived names, no ciphertext. SQLite's unique
    // constraint kept them on separate remote IDs, but both are legacy and get relinked.
    const legacy = (userId: string, id: string, name: string): PokecollectorUserMapping => ({
      userId, pokecollectorUserId: id, pokecollectorUsername: name, updatedAt: "2026-10-01T00:00:00.000Z", passwordCiphertext: null,
    });
    store.savePokecollectorUserMapping(legacy(INVITED_USERS[0].userId, "41", "cardflow-alex"));
    store.savePokecollectorUserMapping(legacy(INVITED_USERS[1].userId, "42", "cardflow-jordan"));
    store.savePokecollectorUserMapping(legacy(GUEST, "43", "cardflow-guest"));
    return { store };
  }
  const alexId = INVITED_USERS[0].userId;
  const jordanId = INVITED_USERS[1].userId;

  /** Mock PokéCollector that can be made to "crash" (throw) at a given call. */
  function crashable() {
    const accounts = createMockPokecollectorAccounts();
    const frozen: string[] = [];
    accounts.freezeRemoteUser = async (id) => {
      frozen.push(id);
      return true;
    };
    const crash = { at: "" as "" | "completeLink" | "addPurchased:2" | "freeze" };
    let purchasedCalls = 0;
    const complete = accounts.completeLink.bind(accounts);
    accounts.completeLink = async (pending) => {
      if (crash.at === "completeLink") throw new Error("crash");
      return complete(pending);
    };
    const addPurchased = accounts.addPurchased.bind(accounts);
    accounts.addPurchased = async (mapping, input) => {
      purchasedCalls += 1;
      if (crash.at === "addPurchased:2" && purchasedCalls === 2) throw new Error("crash");
      return addPurchased(mapping, input);
    };
    const freeze = accounts.freezeRemoteUser;
    accounts.freezeRemoteUser = async (id) => {
      if (crash.at === "freeze") throw new Error("crash");
      return freeze(id);
    };
    return { accounts, frozen, crash };
  }

  async function expectFinished(store: Awaited<ReturnType<typeof legacyWorld>>["store"], accounts: ReturnType<typeof crashable>["accounts"]) {
    const alex = store.getPokecollectorUserMapping(alexId)!;
    const jordan = store.getPokecollectorUserMapping(jordanId)!;
    expect(isReadyLink(alex) && isReadyLink(jordan)).toBe(true);
    expect(alex.pokecollectorUserId).not.toBe(jordan.pokecollectorUserId);
    // Every copy exactly once.
    expect((await accounts.listCollection(alex)).map((c) => c.tcgdexId).sort()).toEqual(["base1-58", "swsh3-136"]);
    expect((await accounts.listWishlist(alex)).map((c) => c.tcgdexId)).toEqual(["base1-4"]);
    expect((await accounts.listCollection(jordan)).map((c) => c.tcgdexId)).toEqual(["swsh3-136"]);
    expect(store.getPokecollectorUserMapping(GUEST)).toBeUndefined();
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
    const state = memoryRelinkState();
    const result = await runPokecollectorRelink({ store, accounts, dryRun: true, state });
    expect(networkCalls).toBe(0);
    expect(state.saves).toBe(0);
    expect(JSON.stringify(store.listPokecollectorUserMappings())).toBe(before);
    expect(result.plan.freeze.map((f) => f.pokecollectorUserId).sort()).toEqual(["41", "42", "43"]);
    expect(result.plan.relink.map((r) => [r.userId, r.purchased, r.watchlist]).sort()).toEqual(
      [[alexId, 2, 1], [jordanId, 1, 0]].sort(),
    );
    expect(result.plan.dropGuestLinks).toEqual([GUEST]);
    expect(planPokecollectorRelink(store)).toEqual(result.plan);
  });

  it("apply (mock PokéCollector only): fresh opaque users rebuilt from CardFlow inventory, old users frozen", async () => {
    const { store } = await legacyWorld();
    const { accounts, frozen } = crashable();
    const result = await runPokecollectorRelink({ store, accounts, dryRun: false, state: memoryRelinkState() });
    expect(result.relinked).toBe(2);
    expect(result.copiesWritten).toBe(4);
    expect(result.guestLinksDropped).toBe(1);
    expect(frozen.sort()).toEqual(["41", "42", "43"]);
    await expectFinished(store, accounts);
    // Running it again finds nothing left to do.
    expect(planPokecollectorRelink(store)).toEqual({ freeze: [], relink: [], dropGuestLinks: [] });
  });

  it("H2: the freeze list is saved before any write (a link row, once replaced, can't say what it pointed at)", async () => {
    const { store } = await legacyWorld();
    const { accounts, crash } = crashable();
    crash.at = "completeLink";
    const state = memoryRelinkState();
    await expect(runPokecollectorRelink({ store, accounts, dryRun: false, state })).rejects.toThrow("crash");
    expect(state.current!.freeze.map((f) => f.pokecollectorUserId).sort()).toEqual(["41", "42", "43"]);
    // Alex's legacy row was already replaced by a pending one: the DB alone no longer knows "41".
    expect(store.getPokecollectorUserMapping(alexId)!.pokecollectorUserId).toMatch(/^pending:/);
    expect(planPokecollectorRelink(store).freeze.map((f) => f.pokecollectorUserId)).not.toContain("41");
    expect(planPokecollectorRelink(store, state.load()).freeze.map((f) => f.pokecollectorUserId)).toContain("41");
  });

  it("H2: a rerun after a crash before linking reuses the pending row and its password", async () => {
    const { store } = await legacyWorld();
    const { accounts, crash, frozen } = crashable();
    crash.at = "completeLink";
    const state = memoryRelinkState();
    await expect(runPokecollectorRelink({ store, accounts, dryRun: false, state })).rejects.toThrow("crash");
    const pending = store.getPokecollectorUserMapping(alexId)!;
    crash.at = "";
    const result = await runPokecollectorRelink({ store, accounts, dryRun: false, state });
    expect(result.plan.relink.find((r) => r.userId === alexId)?.reason).toBe("resume_pending");
    const linked = store.getPokecollectorUserMapping(alexId)!;
    // Same username and the same encrypted password: never a second remote user for one link.
    expect(linked.pokecollectorUsername).toBe(pending.pokecollectorUsername);
    expect(linked.passwordCiphertext).toBe(pending.passwordCiphertext);
    expect([...accounts.remoteUsers.keys()].filter((name) => isOpaquePokecollectorUsername(name))).toHaveLength(2);
    expect(frozen.sort()).toEqual(["41", "42", "43"]);
    await expectFinished(store, accounts);
  });

  it("H2: a crash mid-copy resumes at the next copy (no duplicates, nothing missing)", async () => {
    const { store } = await legacyWorld();
    const { accounts, crash, frozen } = crashable();
    crash.at = "addPurchased:2";
    const state = memoryRelinkState();
    await expect(runPokecollectorRelink({ store, accounts, dryRun: false, state })).rejects.toThrow("crash");
    const done = Object.values(state.current!.progress).reduce((n, p) => n + p.purchased + p.watchlist, 0);
    expect(done).toBe(1);
    expect(frozen).toEqual([]);
    crash.at = "";
    const result = await runPokecollectorRelink({ store, accounts, dryRun: false, state });
    expect(result.plan.relink.map((r) => r.reason)).toContain("resume_copies");
    expect(result.copiesWritten).toBe(3);
    expect(frozen.sort()).toEqual(["41", "42", "43"]);
    await expectFinished(store, accounts);
    expect(Object.values(state.current!.progress).every((p) => p.done)).toBe(true);
  });

  it("H2: a crash during the freeze is finished by a rerun, and a third run does nothing", async () => {
    const { store } = await legacyWorld();
    const { accounts, crash, frozen } = crashable();
    crash.at = "freeze";
    const state = memoryRelinkState();
    await expect(runPokecollectorRelink({ store, accounts, dryRun: false, state })).rejects.toThrow("crash");
    crash.at = "";
    const second = await runPokecollectorRelink({ store, accounts, dryRun: false, state });
    expect(second.copiesWritten).toBe(0);
    expect(second.relinked).toBe(0);
    expect(frozen.sort()).toEqual(["41", "42", "43"]);
    await expectFinished(store, accounts);
    const third = await runPokecollectorRelink({ store, accounts, dryRun: false, state });
    expect([third.relinked, third.copiesWritten, third.frozen, third.strayFrozen]).toEqual([0, 0, 0, 0]);
    expect(frozen).toHaveLength(3);
  });

  it("H2: ends by freezing every unlinked, non-opaque cardflow-* remote user (admin GET /api/auth/users)", async () => {
    const { store } = await legacyWorld();
    const { accounts, frozen } = crashable();
    // Remote users whose link rows were lost: never in the DB, only on PokéCollector.
    const strayId = accounts.seedRemoteUser("cardflow-sean");
    const otherApp = accounts.seedRemoteUser("someone-not-cardflow");
    const admin = accounts.seedRemoteUser("cardflow-admin", { role: "admin" });
    const result = await runPokecollectorRelink({ store, accounts, dryRun: false, state: memoryRelinkState() });
    expect(result.strayFrozen).toBe(1);
    expect(frozen).toContain(strayId);
    expect(frozen).not.toContain(otherApp);
    expect(frozen).not.toContain(admin);
    // The new opaque users stay active.
    for (const id of [alexId, jordanId]) expect(frozen).not.toContain(store.getPokecollectorUserMapping(id)!.pokecollectorUserId);
  });

  it("R1: a 'hold' row nobody live links to is admin-DELETEd, not frozen (the delete copy stays true)", async () => {
    const { store } = await legacyWorld();
    const { accounts, frozen } = crashable();
    // A deleted account's old shared/legacy remote user: no CardFlow account links to it any more.
    const held = accounts.seedRemoteUser("cardflow-sam");
    accounts.seedCollection(held, [{ id: "c1", tcgdexId: "base1-58", quantity: 1, selectedVariant: null, condition: null, purchasePrice: null }]);
    store.accounts.enqueuePokecollectorDeletion({ remoteUserId: held, mode: "hold", at: "2026-10-17T00:00:00.000Z" });
    const plan = planPokecollectorRelink(store);
    expect(plan.freeze).toContainEqual(
      expect.objectContaining({ pokecollectorUserId: held, source: "deletion_hold", pokecollectorUsername: null, action: "delete" }),
    );
    const state = memoryRelinkState();
    const result = await runPokecollectorRelink({ store, accounts, dryRun: false, state });
    expect(result.deleted).toBe(1);
    expect(frozen).not.toContain(held);
    expect([...accounts.remoteUsers.values()].map((u) => u.id)).not.toContain(held);
    expect(store.accounts.listPokecollectorDeletions()).toEqual([]);
    expect(state.current?.deleted).toEqual([held]);
    expect(summarizeRelink(result)).toMatchObject({ deleted: 1, plan: { delete: 1, freeze: 3 } });
    // A rerun does nothing more.
    const again = await runPokecollectorRelink({ store, accounts, dryRun: false, state });
    expect([again.deleted, again.frozen, again.strayFrozen]).toEqual([0, 0, 0]);
  });

  it("R1: a 'hold' row still shared with a live account is frozen after that account moves to its own opaque user", async () => {
    const { store } = await legacyWorld();
    const { accounts, frozen } = crashable();
    let deletes = 0;
    accounts.deleteRemoteUser = async () => {
      deletes += 1;
      return "user_deleted";
    };
    // A deleted account shared remote user 41 with Alex, who is still live.
    store.accounts.enqueuePokecollectorDeletion({ remoteUserId: "41", mode: "hold", at: "2026-10-17T00:00:00.000Z" });
    const plan = planPokecollectorRelink(store);
    expect(plan.freeze.filter((f) => f.pokecollectorUserId === "41")).toEqual([expect.objectContaining({ action: "freeze" })]);
    const result = await runPokecollectorRelink({ store, accounts, dryRun: false, state: memoryRelinkState() });
    expect(deletes).toBe(0);
    expect(result.deleted).toBe(0);
    expect(frozen).toContain("41");
    const alex = store.getPokecollectorUserMapping(alexId)!;
    expect(isReadyLink(alex) && alex.pokecollectorUserId !== "41").toBe(true);
    expect(store.accounts.listPokecollectorDeletions()).toEqual([]);
  });

  it("R1: a failed delete is never turned into a freeze; the hold row stays and a rerun deletes it", async () => {
    const { store } = await legacyWorld();
    const { accounts, frozen } = crashable();
    const held = accounts.seedRemoteUser("cardflow-sam");
    store.accounts.enqueuePokecollectorDeletion({ remoteUserId: held, mode: "hold", at: "2026-10-17T00:00:00.000Z" });
    const realDelete = accounts.deleteRemoteUser.bind(accounts);
    let fail = true;
    accounts.deleteRemoteUser = async (target) => (fail ? "partial" : realDelete(target));
    const state = memoryRelinkState();
    const first = await runPokecollectorRelink({ store, accounts, dryRun: false, state });
    expect(first.deleteFailed).toEqual([held]);
    expect(first.deleted).toBe(0);
    // Not frozen by the delete step or by the stray sweep (it's an unlinked cardflow-* user).
    expect(frozen).not.toContain(held);
    expect(store.accounts.listPokecollectorDeletions().map((r) => r.remoteUserId)).toEqual([held]);
    fail = false;
    const second = await runPokecollectorRelink({ store, accounts, dryRun: false, state });
    expect(second.deleted).toBe(1);
    expect(frozen).not.toContain(held);
    expect(store.accounts.listPokecollectorDeletions()).toEqual([]);
  });

  it("R1: an entry from an older state file (no action) is frozen, never deleted", async () => {
    const { store } = await legacyWorld();
    const { accounts, frozen } = crashable();
    const old = accounts.seedRemoteUser("cardflow-old");
    let deletes = 0;
    accounts.deleteRemoteUser = async () => {
      deletes += 1;
      return "user_deleted";
    };
    const state = memoryRelinkState({
      version: 1,
      freeze: [{ pokecollectorUserId: old, pokecollectorUsername: "cardflow-old", linkedUsers: 1, source: "link" }],
      frozen: [],
      progress: {},
    });
    await runPokecollectorRelink({ store, accounts, dryRun: false, state });
    expect(deletes).toBe(0);
    expect(frozen).toContain(old);
  });

  it("L3: stdout gets counts and hashed IDs only; the full plan goes to a 0600 file", async () => {
    const { store } = await legacyWorld();
    const result = await runPokecollectorRelink({ store, accounts: null, dryRun: true });
    result.relinkFailed.push(alexId);
    const summary = JSON.stringify(summarizeRelink(result));
    for (const secret of [alexId, jordanId, GUEST, "cardflow-alex", "cardflow-jordan", "41"]) expect(summary).not.toContain(secret);
    expect(summary).toContain(hashRelinkId(alexId));
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-relink-"));
    dirs.push(dir);
    const planFile = path.join(dir, "plan.json");
    writePrivateJson(planFile, result);
    expect(statSync(planFile).mode & 0o777).toBe(0o600);
    expect(readFileSync(planFile, "utf8")).toContain(alexId);
    const stateFile = path.join(dir, "state.json");
    const fileState = fileRelinkState(stateFile);
    expect(fileState.load()).toBeNull();
    fileState.save({ version: 1, freeze: [], frozen: ["1"], progress: {} });
    expect(statSync(stateFile).mode & 0o777).toBe(0o600);
    expect(fileState.load()?.frozen).toEqual(["1"]);
  });

  it("apply needs a state file", async () => {
    const { store } = await legacyWorld();
    await expect(runPokecollectorRelink({ store, accounts: createMockPokecollectorAccounts(), dryRun: false })).rejects.toThrow(/state file/);
  });
});
