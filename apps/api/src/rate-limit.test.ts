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
