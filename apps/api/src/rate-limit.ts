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
 * Grading routes are CPU-heavy (~1 GB, ~10 s per grade). Defaults: 6 per minute and
 * 100 per day, per user and per client IP. Off under tests unless configured.
 * CARD_FLOW_GRADE_RATE_LIMIT=false turns it off (local debugging only).
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

/** Best-effort client IP: first X-Forwarded-For hop (behind a proxy), else X-Real-IP. */
export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || c.req.header("x-real-ip")?.trim() || "unknown";
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
  keys: (c: Context) => string[],
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
      const result = limiter(key);
      if (!result.allowed) {
        c.header("Retry-After", String(result.retryAfterSeconds));
        return c.json({ ok: false, error: "Too many requests. Try again in a moment." }, 429);
      }
    }
    return next();
  };
}
