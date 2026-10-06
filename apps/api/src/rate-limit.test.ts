import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { cardgradingChildEnv, createCardgradingEngineProbe, createConcurrencyGate } from "./cardgrading-run";
import { createRateLimiter, gradeRateLimitFromEnv } from "./rate-limit";
import { createMemoryStore } from "./store";

describe("grading rate limit", () => {
  it("allows up to the window max, then returns a retry-after", () => {
    let t = 0;
    const limit = createRateLimiter([{ windowMs: 60_000, max: 2 }], () => t);
    expect(limit("u").allowed).toBe(true);
    expect(limit("u").allowed).toBe(true);
    const third = limit("u");
    expect(third.allowed).toBe(false);
    if (!third.allowed) expect(third.retryAfterSeconds).toBe(60);
    expect(limit("other").allowed).toBe(true);
    t = 60_001;
    expect(limit("u").allowed).toBe(true);
  });

  it("defaults to 6/min and 100/day outside tests, and can be turned off", () => {
    expect(gradeRateLimitFromEnv({})).toEqual({ perMinute: 6, perDay: 100 });
    expect(gradeRateLimitFromEnv({ CARD_FLOW_GRADE_RATE_PER_MIN: "3" })).toEqual({ perMinute: 3, perDay: 100 });
    expect(gradeRateLimitFromEnv({ CARD_FLOW_GRADE_RATE_LIMIT: "false" })).toBeNull();
    expect(gradeRateLimitFromEnv({ VITEST: "true" })).toBeNull();
  });

  it("answers 429 with Retry-After on the grading routes", async () => {
    const app = createApp(createMemoryStore(), {
      devAutoSession: true,
      gradeRateLimit: { perMinute: 1, perDay: 100 },
    });
    const post = () => app.request("/v1/grade/pregrade", { method: "POST", body: new FormData() });
    expect((await post()).status).not.toBe(429);
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it("refuses an oversized grading body before parsing it", async () => {
    const app = createApp(createMemoryStore(), { devAutoSession: true, gradeRateLimit: null });
    const big = new Uint8Array(23 * 1024 * 1024);
    const response = await app.request("/v1/grade/pregrade", {
      method: "POST",
      body: big,
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(big.byteLength) },
    });
    expect(response.status).toBe(413);
  });
});

describe("grader child process", () => {
  it("passes only allowlisted env vars and blanks model keys", () => {
    const env = cardgradingChildEnv({
      PATH: "/bin",
      HOME: "/home/x",
      OMP_NUM_THREADS: "1",
      CARDFLOW_GRADE_DEBUG_IMAGES: "1",
      DATABASE_URL: "postgres://secret",
      CARD_FLOW_POKECOLLECTOR_TOKEN: "secret",
      GEMINI_API_KEY: "secret",
    });
    expect(env.HOME).toBe("/home/x");
    expect(env.OMP_NUM_THREADS).toBe("1");
    expect(env.CARDFLOW_GRADE_DEBUG_IMAGES).toBe("1");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.CARD_FLOW_POKECOLLECTOR_TOKEN).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBe("");
  });

  it("health probe reports not ok when the grader Python can't start", async () => {
    const probe = createCardgradingEngineProbe("/nonexistent/python-for-cardflow");
    const status = await probe();
    expect(status.ok).toBe(false);
    expect(status.opencv).toBeNull();
    expect(await probe()).toBe(status);
  });
});

describe("grader concurrency gate", () => {
  it("runs at most N tasks at once and rejects when the wait runs out", async () => {
    const gate = createConcurrencyGate(1, 50);
    let release!: () => void;
    const first = gate(() => new Promise<string>((resolve) => (release = () => resolve("first"))));
    await expect(gate(async () => "second")).rejects.toThrow(/busy/);
    const third = gate(async () => "third");
    release();
    expect(await first).toBe("first");
    expect(await third).toBe("third");
  });
});

describe("hardening from the #30 review", () => {
  it("ignores a spoofed X-Forwarded-For unless proxy hops are trusted", async () => {
    const { clientIp } = await import("./rate-limit");
    const fake = (xff: string | undefined) =>
      ({ req: { header: (name: string) => (name === "x-forwarded-for" ? xff : undefined) } }) as never;
    const socket = () => "10.0.0.9";
    expect(clientIp(fake("1.2.3.4"), 0, socket)).toBe("10.0.0.9");
    expect(clientIp(fake("1.2.3.4, 203.0.113.7"), 1, socket)).toBe("203.0.113.7");
    expect(clientIp(fake(undefined), 1, socket)).toBe("10.0.0.9");
    expect(clientIp(fake(undefined), 0, () => undefined)).toBeNull();
  });

  it("gives detect its own bucket so retakes don't use up grades", async () => {
    const app = createApp(createMemoryStore(), {
      devAutoSession: true,
      gradeRateLimit: { perMinute: 1, perDay: 100 },
      detectRateLimit: { perMinute: 3, perDay: 100 },
    });
    const detect = () => app.request("/v1/grade/detect", { method: "POST", body: new FormData() });
    for (let i = 0; i < 3; i += 1) expect((await detect()).status).not.toBe(429);
    expect((await detect()).status).toBe(429);
    const grade = await app.request("/v1/grade/pregrade", { method: "POST", body: new FormData() });
    expect(grade.status).not.toBe(429);
  });

  it("answers 503 + Retry-After when the grade queue is full, and applies the daily cap", async () => {
    const full = createApp(createMemoryStore(), { devAutoSession: true, gradeGate: { isFull: () => true } });
    const busy = await full.request("/v1/grade/pregrade", { method: "POST", body: new FormData() });
    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("15");

    const capped = createApp(createMemoryStore(), { devAutoSession: true, gradeDailyCap: 1 });
    await capped.request("/v1/grade/pregrade", { method: "POST", body: new FormData() });
    const second = await capped.request("/v1/grade/pregrade", { method: "POST", body: new FormData() });
    expect(second.status).toBe(429);
  });

  it("rejects instead of queueing when the gate's queue is full; default concurrency is 1", async () => {
    const { createConcurrencyGate, gradeGateFromEnv, GradeBusyError } = await import("./cardgrading-run");
    const gate = createConcurrencyGate(1, 1_000, 1);
    let release!: () => void;
    const first = gate(() => new Promise<void>((resolve) => (release = resolve)));
    const queued = gate(async () => "queued");
    expect(gate.isFull()).toBe(true);
    await expect(gate(async () => "third")).rejects.toBeInstanceOf(GradeBusyError);
    release();
    await first;
    expect(await queued).toBe("queued");
    const envGate = gradeGateFromEnv({});
    let hold!: () => void;
    const one = envGate(() => new Promise<void>((resolve) => (hold = resolve)));
    expect(envGate.isFull()).toBe(false);
    hold();
    await one;
  });

  it("derives the 413 copy from the real request cap", async () => {
    const app = createApp(createMemoryStore(), { devAutoSession: true });
    const big = new Uint8Array(23 * 1024 * 1024);
    const response = await app.request("/v1/grade/pregrade", {
      method: "POST",
      body: big,
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(big.byteLength) },
    });
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: string }).error).toBe("Upload must be 22 MB or smaller");
  });
});
