import { afterEach, describe, expect, it, vi } from "vitest";
import { EMAIL_UNVERIFIED_CODE, EMAIL_VERIFICATION_COPY } from "@cardflow/shared";
import { createApp } from "./app";
import { createDevLogSender, createResendSender, emailSenderFromEnv, emailSenderProblems, RESEND_ENDPOINT, type EmailMessage, type EmailSender } from "./email-sender";
import { JORDAN_INVITE_CODE } from "./invited-testers";
import { productionConfigProblems, productionConfigWarnings } from "./production-config";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";
import { createMemoryStore } from "./store";

const stores: SqliteStorePort[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  vi.restoreAllMocks();
});

function capture(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return { name: "test", sent, send: async (m) => (sent.push(m), true) };
}

function open(kind: "sqlite" | "memory" = "sqlite", extra: Parameters<typeof createApp>[1] = {}) {
  const store = kind === "sqlite" ? createSqliteStore({ sqlitePath: ":memory:" }) : createMemoryStore();
  if (kind === "sqlite") stores.push(store as SqliteStorePort);
  const mail = capture();
  let clock = new Date("2026-10-17T05:00:00.000Z");
  let purge: (() => { accountsPurged: number }) | null = null;
  const app = createApp(store, {
    devAutoSession: false,
    emailSender: mail,
    now: () => clock,
    unverifiedPurgeIntervalMs: 0,
    onUnverifiedPurge: (run) => (purge = run),
    ...extra,
  });
  return { app, mail, store, purge: () => purge!(), advance: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
}

type App = ReturnType<typeof createApp>;
async function call(app: App, path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await app.request(path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const PW = "correct horse battery";
const GRADE_ROUTES = [
  "/v1/grade/detect",
  "/v1/grade/pregrade",
  "/v1/grading/batch",
  "/v1/inventory/inv-1/grade-jobs",
  "/v1/inventory/inv-1/grade-estimate",
];

async function signUp(app: App, email = "sam@example.com") {
  const up = await call(app, "/v1/accounts", { body: { email, password: PW } });
  expect(up.status).toBe(200);
  return up.body.token as string;
}

describe.each(["sqlite", "memory"] as const)("email verification (%s store)", (kind) => {
  it("sign-up emails a 6-digit code; pre-grade estimate routes return 403 email_unverified until it's confirmed", async () => {
    const { app, mail } = open(kind);
    const up = await call(app, "/v1/accounts", { body: { email: "sam@example.com", password: PW } });
    expect(up.body.emailVerified).toBe(false);
    const token = up.body.token as string;
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ kind: "verify-email", to: "sam@example.com", subject: EMAIL_VERIFICATION_COPY.emailSubject });
    expect(mail.sent[0]!.code).toMatch(/^\d{6}$/);
    expect(mail.sent[0]!.text).toContain(mail.sent[0]!.code);
    expect((await call(app, "/v1/identity", { token })).body.emailVerified).toBe(false);

    for (const route of GRADE_ROUTES) {
      const res = await call(app, route, { body: {}, token });
      expect(res.status, route).toBe(403);
      expect(res.body).toMatchObject({ ok: false, error: EMAIL_UNVERIFIED_CODE, message: EMAIL_VERIFICATION_COPY.required });
    }
    // Everything else still works while unverified.
    expect((await call(app, "/v1/inventory", { token })).status).toBe(200);
    expect((await call(app, "/v1/grade/quota", { token })).status).toBe(200);

    const wrong = mail.sent[0]!.code === "000000" ? "111111" : "000000";
    expect((await call(app, "/v1/email-verifications/confirm", { body: { code: wrong }, token })).status).toBe(400);
    const ok = await call(app, "/v1/email-verifications/confirm", { body: { code: mail.sent[0]!.code }, token });
    expect(ok).toMatchObject({ status: 200, body: { ok: true, emailVerified: true } });
    expect((await call(app, "/v1/identity", { token })).body.emailVerified).toBe(true);
    // (Batch still answers 403 for free plans, but for the premium reason, not email.)
    for (const route of GRADE_ROUTES) expect((await call(app, route, { body: {}, token })).body.error, route).not.toBe(EMAIL_UNVERIFIED_CODE);
    // Signing in again reports the account as verified.
    expect((await call(app, "/v1/sessions/password", { body: { email: "sam@example.com", password: PW } })).body.emailVerified).toBe(true);
  });

  it("codes expire after 15 minutes", async () => {
    const { app, mail, advance } = open(kind);
    const token = await signUp(app);
    advance(15 * 60 * 1000 + 1);
    const res = await call(app, "/v1/email-verifications/confirm", { body: { code: mail.sent[0]!.code }, token });
    expect(res).toMatchObject({ status: 400, body: { error: EMAIL_VERIFICATION_COPY.invalid } });
  });

  it("five wrong tries end the code, even if the right one comes next", async () => {
    const { app, mail } = open(kind);
    const token = await signUp(app);
    const code = mail.sent[0]!.code;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) expect((await call(app, "/v1/email-verifications/confirm", { body: { code: wrong }, token })).status).toBe(400);
    expect((await call(app, "/v1/email-verifications/confirm", { body: { code }, token })).status).toBe(400);
  });

  it("resend: one a minute, five an hour; a new code replaces the old one", async () => {
    const { app, mail, advance } = open(kind);
    const token = await signUp(app);
    const first = mail.sent[0]!.code;
    // The sign-up code doesn't block the first resend; the second within a minute is refused.
    expect((await call(app, "/v1/email-verifications", { method: "POST", token })).status).toBe(202);
    const tooSoon = await call(app, "/v1/email-verifications", { method: "POST", token });
    expect(tooSoon).toMatchObject({ status: 429, body: { error: EMAIL_VERIFICATION_COPY.tooSoon } });
    for (let i = 0; i < 4; i += 1) {
      advance(61_000);
      expect((await call(app, "/v1/email-verifications", { method: "POST", token })).status).toBe(202);
    }
    advance(61_000);
    expect((await call(app, "/v1/email-verifications", { method: "POST", token })).status).toBe(429);
    expect(mail.sent).toHaveLength(6);
    const latest = mail.sent.at(-1)!.code;
    if (first !== latest) {
      expect((await call(app, "/v1/email-verifications/confirm", { body: { code: first }, token })).status).toBe(400);
    }
    expect((await call(app, "/v1/email-verifications/confirm", { body: { code: latest }, token })).status).toBe(200);
    // Single use and done: verified accounts aren't sent more codes.
    expect((await call(app, "/v1/email-verifications", { method: "POST", token })).body).toMatchObject({ ok: true, emailVerified: true });
    expect(mail.sent).toHaveLength(6);
  });

  it("invite-code testers count as verified (no code, no 403)", async () => {
    const { app, mail } = open(kind);
    const session = await call(app, "/v1/sessions", { body: { inviteCode: JORDAN_INVITE_CODE } });
    const token = session.body.token as string;
    expect((await call(app, "/v1/identity", { token })).body.emailVerified).toBe(true);
    for (const route of GRADE_ROUTES) expect((await call(app, route, { body: {}, token })).body.error, route).not.toBe(EMAIL_UNVERIFIED_CODE);
    expect((await call(app, "/v1/email-verifications", { method: "POST", token })).body.emailVerified).toBe(true);
    expect(mail.sent).toHaveLength(0);
  });

  it("M1: an account can be sent at most 10 codes in its lifetime", async () => {
    const { app, mail, advance } = open(kind);
    const token = await signUp(app); // 1
    let accepted = 0;
    for (let i = 0; i < 12; i += 1) {
      advance(61 * 60 * 1000); // past the minute and hour limits
      const res = await call(app, "/v1/email-verifications", { method: "POST", token });
      if (res.status === 202) accepted += 1;
      else expect(res.body.error).toBe(EMAIL_VERIFICATION_COPY.sendLimit);
    }
    expect(accepted).toBe(9);
    expect(mail.sent.filter((m) => m.kind === "verify-email")).toHaveLength(10);
  });

  it("M1: one address gets at most 10 emails a day (reset emails count too); the next day it resets", async () => {
    const { app, mail, advance } = open(kind);
    await signUp(app); // verification email #1
    for (let i = 0; i < 12; i += 1) {
      expect((await call(app, "/v1/password-resets", { body: { email: "sam@example.com" } })).status).toBe(202);
      advance(10 * 60 * 1000);
    }
    expect(mail.sent).toHaveLength(10);
    advance(24 * 60 * 60 * 1000);
    await call(app, "/v1/password-resets", { body: { email: "sam@example.com" } });
    expect(mail.sent).toHaveLength(11);
  });

  it("M1: accounts still unverified after 7 days are deleted; verified ones stay", async () => {
    const { app, mail, purge, advance, store } = open(kind);
    const unverified = await call(app, "/v1/accounts", { body: { email: "late@example.com", password: PW } });
    const keep = await call(app, "/v1/accounts", { body: { email: "keep@example.com", password: PW } });
    const code = mail.sent.find((m) => m.to === "keep@example.com")!.code;
    await call(app, "/v1/email-verifications/confirm", { body: { code }, token: keep.body.token as string });
    advance(6 * 86_400_000);
    expect(purge().accountsPurged).toBe(0);
    advance(86_400_000 + 1000);
    expect(purge().accountsPurged).toBe(1);
    const lateId = (unverified.body.identity as { userId: string }).userId;
    expect(store.accounts.getAccount(lateId)).toBeNull();
    expect((await call(app, "/v1/identity", { token: unverified.body.token as string })).status).toBe(401);
    expect((await call(app, "/v1/identity", { token: keep.body.token as string })).status).toBe(200);
  });

  it("M3: no account row is not verified (only invite testers are, by ID)", () => {
    const { store } = open(kind);
    expect(store.accounts.isEmailVerified("acct_nobody")).toBe(false);
    expect(store.accounts.isEmailVerified("guest_123")).toBe(false);
  });

  it("PATCH /v1/identity shares the invite limiter with POST /v1/sessions", async () => {
    const { app } = open(kind, { authLimits: { invitePerIp: 2 } });
    const session = await call(app, "/v1/sessions", { body: { inviteCode: JORDAN_INVITE_CODE } });
    const token = session.body.token as string;
    expect((await call(app, "/v1/identity", { method: "PATCH", body: { inviteCode: "wrong" }, token })).status).toBe(401);
    expect((await call(app, "/v1/identity", { method: "PATCH", body: { inviteCode: "wrong" }, token })).status).toBe(429);
  });

  it("password reset codes go through the same email sender", async () => {
    const { app, mail } = open(kind);
    await signUp(app);
    const res = await call(app, "/v1/password-resets", { body: { email: "sam@example.com" } });
    expect(res.status).toBe(202);
    const reset = mail.sent.find((m) => m.kind === "password-reset")!;
    expect(reset).toMatchObject({ to: "sam@example.com", subject: EMAIL_VERIFICATION_COPY.resetSubject });
    expect(reset.text).toContain(reset.code);
    const confirm = await call(app, "/v1/password-resets/confirm", { body: { token: reset.code, password: "another long password" } });
    expect(confirm.status).toBe(200);
    // Unknown email: same answer, nothing sent.
    const before = mail.sent.length;
    expect((await call(app, "/v1/password-resets", { body: { email: "nobody@example.com" } })).status).toBe(202);
    expect(mail.sent).toHaveLength(before);
  });
});

describe("email sender", () => {
  const message: EmailMessage = { kind: "verify-email", to: "sam@example.com", subject: "S", text: "Code 123456", code: "123456" };

  it("Resend: POSTs JSON to the Resend API with the bearer key", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const sender = createResendSender({ apiKey: "re_test", from: "CardFlow <no-reply@cardflow.test>", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await sender.send(message)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body as string)).toEqual({ from: "CardFlow <no-reply@cardflow.test>", to: ["sam@example.com"], subject: "S", text: "Code 123456" });
  });

  it("Resend failures resolve false and never log the key or code", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const refused = createResendSender({ apiKey: "re_secret", from: "f", fetchImpl: (async () => new Response("no", { status: 422 })) as unknown as typeof fetch });
    expect(await refused.send(message)).toBe(false);
    const down = createResendSender({ apiKey: "re_secret", from: "f", fetchImpl: (async () => { throw new Error("re_secret 123456"); }) as unknown as typeof fetch });
    expect(await down.send(message)).toBe(false);
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).not.toContain("re_secret");
    expect(logged).not.toContain("123456");
  });

  it("no sender: the code is logged in development only", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await createDevLogSender({ NODE_ENV: "development" }).send(message)).toBe(true);
    expect(info.mock.calls.flat().join(" ")).toContain("123456");
    info.mockClear();
    expect(await createDevLogSender({ NODE_ENV: "production" }).send(message)).toBe(false);
    expect([...info.mock.calls, ...warn.mock.calls].flat().join(" ")).not.toContain("123456");
  });

  it("env: resend needs RESEND_API_KEY and CARD_FLOW_EMAIL_FROM; production refuses half-configured senders", () => {
    expect(emailSenderProblems({})).toEqual([]);
    expect(emailSenderProblems({ CARD_FLOW_EMAIL_SENDER: "smtp" })).toHaveLength(1);
    expect(emailSenderProblems({ CARD_FLOW_EMAIL_SENDER: "resend" })).toHaveLength(2);
    expect(emailSenderProblems({ CARD_FLOW_EMAIL_SENDER: "resend", RESEND_API_KEY: "k", CARD_FLOW_EMAIL_FROM: "f" })).toEqual([]);
    expect(emailSenderFromEnv({ CARD_FLOW_EMAIL_SENDER: "resend", RESEND_API_KEY: "k", CARD_FLOW_EMAIL_FROM: "f" }).name).toBe("resend");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(emailSenderFromEnv({ CARD_FLOW_EMAIL_SENDER: "resend" }).name).toBe("dev-log");
    const prod = { NODE_ENV: "production", CARD_FLOW_TRUST_PROXY_HOPS: "1", CARD_FLOW_SERVER_PEPPER: "p".repeat(32) };
    expect(productionConfigProblems({ ...prod, CARD_FLOW_EMAIL_SENDER: "resend" })).toHaveLength(2);
    expect(productionConfigProblems(prod)).toEqual([]);
    expect(productionConfigWarnings(prod)).toHaveLength(1);
    expect(productionConfigWarnings({ ...prod, CARD_FLOW_EMAIL_SENDER: "resend", RESEND_API_KEY: "k", CARD_FLOW_EMAIL_FROM: "f" })).toEqual([]);
  });
});
