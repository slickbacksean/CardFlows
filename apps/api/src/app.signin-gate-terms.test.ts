import { describe, expect, it } from "vitest";
import { AGE_GATE_VERSION, TERMS_REQUIRED_CODE, TERMS_VERSION } from "@cardflow/shared";
import { createApp } from "./app";
import { openToken, sealToken } from "./apple-revoke";
import { socialIdentityFromClaims, socialAuthConfigFromEnv, type SocialTokenVerifier } from "./social-auth";
import { createSqliteStore } from "./sqlite-store";
import { createMemoryStore, type StorePort } from "./store";

type App = ReturnType<typeof createApp>;
type Body = Record<string, unknown>;

async function req(app: App, path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await app.request(path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Body };
}

const over18 = { ageConfirmed18Plus: true, ageGateVersion: AGE_GATE_VERSION };
const terms = { termsAccepted: true, termsVersion: TERMS_VERSION };
const signUp = (email: string, extra: Body = {}) => ({ email, password: "correct horse battery", ...extra });

/** Mocked provider verification: token "good:<sub>:<email>" is valid; anything else throws. */
const verifier: SocialTokenVerifier = async ({ provider, idToken }) => {
  const [kind, sub, email] = idToken.split(":");
  if (kind !== "good" || !sub) throw new Error("bad token");
  return { provider, subject: sub, email: email || null, emailVerified: Boolean(email) };
};
const revoked: string[] = [];
const apple = {
  exchangeCode: async (code: string) => (code === "code-ok" ? "refresh-1" : null),
  revoke: async (token: string) => {
    revoked.push(token);
    return true;
  },
};
const socialAuth = { config: { appleAudiences: ["app.pokesniper.mobile"], googleClientIds: ["g-ios", "g-web"] }, verifier, apple };

describe.each(["memory", "sqlite"] as const)("Sean (Oct 19): sign-in gate, Terms, Apple/Google (%s)", (kind) => {
  function open(extra: Body = {}): { app: App; store: StorePort } {
    const store = kind === "sqlite" ? createSqliteStore({ sqlitePath: ":memory:" }) : createMemoryStore();
    return { app: createApp(store, { devAutoSession: false, ageGate: true, termsGate: true, socialAuth, ...extra }), store };
  }

  it("every app route needs a signed-in account; health and auth stay public", async () => {
    const { app } = open();
    for (const path of ["/v1/inventory", "/v1/identity", "/v1/catalog/search?q=pikachu", "/v1/dex/sets", "/v1/scans"]) {
      expect((await req(app, path)).status, path).toBe(401);
    }
    expect((await req(app, "/v1/livestream/identify", { body: { source: "live_video" } })).status).toBe(401);
    expect((await req(app, "/health")).status).toBe(200);
    expect((await req(app, "/v1/auth/providers")).body).toMatchObject({ ok: true, apple: true, google: true });
    expect((await req(app, "/v1/sessions/guest", { method: "POST" })).status).toBe(404);
  });

  it("sign-up requires the Terms checkbox and stores version + accepted_at", async () => {
    const { app, store } = open({ now: () => new Date("2026-10-19T20:00:00.000Z") });
    const refused = await req(app, "/v1/accounts", { body: signUp("a@example.com", over18) });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe(TERMS_REQUIRED_CODE);
    expect(store.accounts.findByEmail("a@example.com")).toBeNull();
    expect((await req(app, "/v1/accounts", { body: signUp("a@example.com", { ...over18, termsAccepted: true, termsVersion: "old" }) })).status).toBe(400);
    const ok = await req(app, "/v1/accounts", { body: signUp("a@example.com", { ...over18, ...terms }) });
    expect(ok.status).toBe(200);
    expect(store.accounts.findByEmail("a@example.com")).toMatchObject({ termsVersion: TERMS_VERSION, termsAcceptedAt: "2026-10-19T20:00:00.000Z" });
    expect((await req(app, "/v1/identity", { token: ok.body.token as string })).body.hasPassword).toBe(true);
  });

  it("social sign-up needs Terms + 18+ before any account exists, then signs in by subject", async () => {
    const { app, store } = open();
    const bad = await req(app, "/v1/sessions/social", { body: { provider: "google", idToken: "forged" } });
    expect(bad.status).toBe(401);
    const first = await req(app, "/v1/sessions/social", { body: { provider: "google", idToken: "good:g1:new@example.com" } });
    expect(first.status).toBe(400);
    expect(first.body).toMatchObject({ error: "signup_details_required", needs: { age: true, terms: true } });
    expect(store.accounts.findByEmail("new@example.com")).toBeNull();
    const onlyTerms = await req(app, "/v1/sessions/social", { body: { provider: "google", idToken: "good:g1:new@example.com", ...terms } });
    expect(onlyTerms.body).toMatchObject({ needs: { age: true, terms: false } });
    const created = await req(app, "/v1/sessions/social", { body: { provider: "google", idToken: "good:g1:new@example.com", ...terms, ...over18 } });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ created: true, emailVerified: true, hasPassword: false });
    const account = store.accounts.findByEmail("new@example.com")!;
    expect(account.termsVersion).toBe(TERMS_VERSION);
    expect(store.ageConfirmations.get(account.userId)?.ageConfirmed18Plus).toBe(true);
    // Later sign-in: same subject, no checkboxes needed (Apple sends no email after the first time).
    const again = await req(app, "/v1/sessions/social", { body: { provider: "google", idToken: "good:g1:" } });
    expect(again.status).toBe(200);
    expect((again.body.identity as { userId: string }).userId).toBe(account.userId);
    // Passwordless accounts delete without a password.
    expect((await req(app, "/v1/account/delete", { body: {}, token: again.body.token as string })).status).toBe(200);
  });

  it("links Apple to a VERIFIED same-email account; keeps its password and sessions", async () => {
    const { app, store } = open();
    const up = await req(app, "/v1/accounts", { body: signUp("me@example.com", { ...over18, ...terms }) });
    const userId = store.accounts.findByEmail("me@example.com")!.userId;
    store.accounts.markEmailVerified(userId, new Date().toISOString());
    const linked = await req(app, "/v1/sessions/social", { body: { provider: "apple", idToken: "good:a1:me@example.com", nonce: "n" } });
    expect(linked.status).toBe(200);
    expect((linked.body.identity as { userId: string }).userId).toBe(userId);
    expect(linked.body.hasPassword).toBe(true);
    expect(store.accounts.findUserBySocial("apple", "a1")).toBe(userId);
    expect((await req(app, "/v1/identity", { token: up.body.token as string })).status).toBe(200);
    expect((await req(app, "/v1/sessions/password", { body: signUp("me@example.com") })).status).toBe(200);
    expect((await req(app, "/v1/sessions/social", { body: { provider: "apple", idToken: "good:a2:" } })).status).toBe(401);
  });

  it("takes over an UNVERIFIED same-email account: password cleared, sessions revoked", async () => {
    const { app, store } = open();
    const squatter = await req(app, "/v1/accounts", { body: signUp("victim@example.com", { ...over18, ...terms }) });
    const userId = store.accounts.findByEmail("victim@example.com")!.userId;
    const owner = await req(app, "/v1/sessions/social", { body: { provider: "google", idToken: "good:g9:victim@example.com" } });
    expect(owner.status).toBe(200);
    expect(owner.body).toMatchObject({ hasPassword: false, emailVerified: true });
    expect((await req(app, "/v1/identity", { token: squatter.body.token as string })).status).toBe(401);
    expect((await req(app, "/v1/sessions/password", { body: signUp("victim@example.com") })).status).toBe(401);
    expect((await req(app, "/v1/identity", { token: owner.body.token as string })).body.hasPassword).toBe(false);
    expect(store.accounts.findUserBySocial("google", "g9")).toBe(userId);
  });

  it("existing accounts without the current Terms accept them on next sign-in", async () => {
    const { app, store } = open();
    await req(app, "/v1/accounts", { body: signUp("old@example.com", { ...over18, ...terms }) });
    const userId = store.accounts.findByEmail("old@example.com")!.userId;
    store.accounts.setTermsAcceptance(userId, "2020-01-01", "2020-01-01T00:00:00.000Z");
    const refused = await req(app, "/v1/sessions/password", { body: signUp("old@example.com") });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe(TERMS_REQUIRED_CODE);
    const ok = await req(app, "/v1/sessions/password", { body: signUp("old@example.com", terms) });
    expect(ok.status).toBe(200);
    expect(store.accounts.getAccount(userId)?.termsVersion).toBe(TERMS_VERSION);
  });

  it("Apple: stores the refresh token sealed and revokes it on account deletion; off without the key", async () => {
    const { app, store } = open();
    revoked.length = 0;
    const created = await req(app, "/v1/sessions/social", {
      body: { provider: "apple", idToken: "good:a7:a7@example.com", authorizationCode: "code-ok", ...terms, ...over18 },
    });
    expect(created.status).toBe(200);
    const userId = (created.body.identity as { userId: string }).userId;
    const sealed = store.accounts.listSocialRefreshTokens(userId);
    expect(sealed).toHaveLength(1);
    expect(sealed[0]!.sealed).not.toContain("refresh-1");
    expect((await req(app, "/v1/account/delete", { body: {}, token: created.body.token as string })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(revoked).toEqual(["refresh-1"]);
    const noKey = open({ socialAuth: { config: socialAuth.config, verifier, apple: null } }).app;
    expect((await req(noKey, "/v1/auth/providers")).body).toMatchObject({ apple: false, google: true });
    expect((await req(noKey, "/v1/sessions/social", { body: { provider: "apple", idToken: "good:a1:x@example.com" } })).status).toBe(404);
    const off = open({ socialAuth: { config: { appleAudiences: [], googleClientIds: [] }, verifier, apple } }).app;
    expect((await req(off, "/v1/auth/providers")).body).toMatchObject({ apple: false, google: false });
  });
});

describe("social token claims (signature checked by jose; claims here)", () => {
  it("Apple nonce must match the SHA-256 of the raw nonce; email_verified gates linking", () => {
    const sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // sha256("")
    expect(socialIdentityFromClaims("apple", { sub: "s", nonce: sha, email: "x@y.z", email_verified: "true" }, "")).toMatchObject({ emailVerified: true });
    expect(() => socialIdentityFromClaims("apple", { sub: "s", nonce: "other" }, "raw")).toThrow(/nonce/);
    expect(socialIdentityFromClaims("google", { sub: "s", email: "x@y.z", email_verified: false }).emailVerified).toBe(false);
    expect(() => socialIdentityFromClaims("google", {})).toThrow();
  });

  it("providers are off unless configured", () => {
    expect(socialAuthConfigFromEnv({})).toEqual({ appleAudiences: [], googleClientIds: [] });
    expect(socialAuthConfigFromEnv({ CARD_FLOW_APPLE_SIGNIN: "true", CARD_FLOW_GOOGLE_CLIENT_IDS: "a, b" })).toEqual({
      appleAudiences: ["app.pokesniper.mobile"],
      googleClientIds: ["a", "b"],
    });
  });
});

describe("Apple refresh token sealing", () => {
  it("round-trips and rejects tampering", () => {
    const sealed = sealToken("abc");
    expect(openToken(sealed)).toBe("abc");
    expect(openToken(sealed.slice(0, -2) + "AA")).toBeNull();
  });
});
