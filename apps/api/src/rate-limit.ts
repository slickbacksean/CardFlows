import type { Context, MiddlewareHandler } from "hono";

type Env = NodeJS.Dict<string | undefined>;

export interface RateWindow {
  windowMs: number;
  max: number;
}

export interface RateLimitConfig {
  perMinute: number;
  perDay: number;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw?.trim() ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isTestEnv(env: Env): boolean {
  return env.VITEST === "true" || env.NODE_ENV === "test";
}

/**
 * Per-user and per-client-IP limits. Grades (pregrade + estimate) default to 6/min and
 * 100/day; detect (crop check, called on every retake) has its own 20/min and 300/day.
 * Off under tests unless configured. CARD_FLOW_GRADE_RATE_LIMIT=false turns all off.
 */
export function gradeRateLimitFromEnv(env: Env = process.env): RateLimitConfig | null {
  if (env.CARD_FLOW_GRADE_RATE_LIMIT?.trim().toLowerCase() === "false") return null;
  if (isTestEnv(env) && !env.CARD_FLOW_GRADE_RATE_PER_MIN && !env.CARD_FLOW_GRADE_RATE_PER_DAY) {
    return null;
  }
  return {
    perMinute: positiveInt(env.CARD_FLOW_GRADE_RATE_PER_MIN, 6),
    perDay: positiveInt(env.CARD_FLOW_GRADE_RATE_PER_DAY, 100),
  };
}

export function detectRateLimitFromEnv(env: Env = process.env): RateLimitConfig | null {
  if (env.CARD_FLOW_GRADE_RATE_LIMIT?.trim().toLowerCase() === "false") return null;
  if (isTestEnv(env) && !env.CARD_FLOW_DETECT_RATE_PER_MIN && !env.CARD_FLOW_DETECT_RATE_PER_DAY) {
    return null;
  }
  return {
    perMinute: positiveInt(env.CARD_FLOW_DETECT_RATE_PER_MIN, 20),
    perDay: positiveInt(env.CARD_FLOW_DETECT_RATE_PER_DAY, 300),
  };
}

/** Whole-instance cap on grades per day (CARD_FLOW_GRADE_DAILY_CAP, default 1000). Null in tests. */
export function globalGradeDailyCapFromEnv(env: Env = process.env): number | null {
  if (env.CARD_FLOW_GRADE_RATE_LIMIT?.trim().toLowerCase() === "false") return null;
  if (isTestEnv(env) && !env.CARD_FLOW_GRADE_DAILY_CAP) return null;
  return positiveInt(env.CARD_FLOW_GRADE_DAILY_CAP, 1000);
}

/**
 * Number of reverse proxies in front of the API whose X-Forwarded-For entries are
 * trusted (CARD_FLOW_TRUST_PROXY_HOPS, default 0 = trust none, use the socket address).
 */
export function trustProxyHopsFromEnv(env: Env = process.env): number {
  const value = Number.parseInt(env.CARD_FLOW_TRUST_PROXY_HOPS?.trim() ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Client IP for rate limiting. With 0 trusted hops, the TCP peer address (the header
 * is ignored, so a client can't spoof it). With N hops, the Nth address from the right
 * of X-Forwarded-For, which our own proxies appended. Null when unknown: callers then
 * skip the IP bucket instead of putting every client into one shared bucket.
 */
export function clientIp(
  c: Context,
  trustedHops: number,
  socketAddress: (c: Context) => string | undefined,
): string | null {
  if (trustedHops > 0) {
    const hops = (c.req.header("x-forwarded-for") ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const candidate = hops[hops.length - trustedHops];
    if (candidate) return candidate;
  }
  return socketAddress(c) ?? null;
}

/**
 * In-memory fixed-window limiter. Fine for one instance; use a shared store
 * (Redis/DB) before running several replicas.
 */
export function createRateLimiter(
  windows: RateWindow[],
  now: () => number = Date.now,
): (key: string) => { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = now();
  return (key) => {
    const t = now();
    if (t - lastSweep > MINUTE) {
      for (const [k, bucket] of buckets) if (bucket.resetAt <= t) buckets.delete(k);
      lastSweep = t;
    }
    let retryAfterMs = 0;
    for (const window of windows) {
      const id = `${window.windowMs}:${key}`;
      const bucket = buckets.get(id);
      if (bucket && bucket.resetAt > t && bucket.count >= window.max) {
        retryAfterMs = Math.max(retryAfterMs, bucket.resetAt - t);
      }
    }
    if (retryAfterMs > 0) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    for (const window of windows) {
      const id = `${window.windowMs}:${key}`;
      const bucket = buckets.get(id);
      if (!bucket || bucket.resetAt <= t) buckets.set(id, { count: 1, resetAt: t + window.windowMs });
      else bucket.count += 1;
    }
    return { allowed: true };
  };
}

/** Middleware: limits by each key returned (e.g. user id and client IP). 429 + Retry-After. */
export function rateLimitMiddleware(
  config: RateLimitConfig | null,
  keys: (c: Context) => Array<string | null>,
  now: () => number = Date.now,
): MiddlewareHandler {
  if (!config) return async (_c, next) => next();
  const limiter = createRateLimiter(
    [
      { windowMs: MINUTE, max: config.perMinute },
      { windowMs: DAY, max: config.perDay },
    ],
    now,
  );
  return async (c, next) => {
    for (const key of keys(c)) {
      if (!key) continue;
      const result = limiter(key);
      if (!result.allowed) {
        c.header("Retry-After", String(result.retryAfterSeconds));
        return c.json({ ok: false, error: "Too many requests. Try again in a moment." }, 429);
      }
    }
    return next();
  };
}

/** Middleware: one shared daily bucket for the whole instance. 429 + Retry-After. */
export function globalDailyCapMiddleware(cap: number | null, now: () => number = Date.now): MiddlewareHandler {
  if (!cap) return async (_c, next) => next();
  const limiter = createRateLimiter([{ windowMs: DAY, max: cap }], now);
  return async (c, next) => {
    const result = limiter("global");
    if (!result.allowed) {
      c.header("Retry-After", String(result.retryAfterSeconds));
      return c.json({ ok: false, error: "CardFlow is busy today. Try again later." }, 429);
    }
    return next();
  };
}
