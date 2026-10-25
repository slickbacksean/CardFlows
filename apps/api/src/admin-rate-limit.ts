/**
 * Admin rate limiting with token bucket algorithm
 * Sean (Oct 25): Per-IP and per-user rate limits for admin endpoints
 */

import type { Context } from "hono";

export interface TokenBucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillRate: number; // tokens per second
}

export interface RateLimitConfig {
  capacity: number;
  refillRate: number;
}

// Rate limit configurations
export const RATE_LIMITS = {
  // Admin login attempts: 5 attempts per minute per IP
  adminLogin: { capacity: 5, refillRate: 5 / 60 },
  // Admin routes (general): 60 requests per minute per user
  adminUser: { capacity: 60, refillRate: 1 },
  // Admin routes (per IP): 120 requests per minute per IP
  adminIp: { capacity: 120, refillRate: 2 },
} as const;

/**
 * In-memory token bucket store
 * In production, consider using Redis for distributed rate limiting
 */
class RateLimitStore {
  private buckets = new Map<string, TokenBucket>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Clean up old buckets every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  getBucket(key: string, config: RateLimitConfig): TokenBucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        tokens: config.capacity,
        lastRefill: Date.now(),
        capacity: config.capacity,
        refillRate: config.refillRate,
      };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  refillAndConsume(bucket: TokenBucket): boolean {
    const now = Date.now();
    const timePassed = (now - bucket.lastRefill) / 1000; // seconds
    const tokensToAdd = timePassed * bucket.refillRate;
    
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  cleanup(): void {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes

    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > maxAge && bucket.tokens >= bucket.capacity) {
        this.buckets.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.buckets.clear();
  }

  // For testing
  reset(): void {
    this.buckets.clear();
  }

  getBucketCount(): number {
    return this.buckets.size;
  }
}

// Global rate limit store
const rateLimitStore = new RateLimitStore();

/**
 * Get client IP from request
 */
export function getClientIp(c: Context): string {
  // Check X-Forwarded-For (for proxied requests)
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    // Take the first IP in the list
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  // Check X-Real-IP
  const realIp = c.req.header("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  return "unknown";
}

/**
 * Check rate limit and consume a token if available
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): { allowed: boolean; retryAfter?: number } {
  const bucket = rateLimitStore.getBucket(key, config);
  const allowed = rateLimitStore.refillAndConsume(bucket);

  if (!allowed) {
    // Calculate retry-after in seconds
    const retryAfter = Math.ceil((1 - bucket.tokens) / config.refillRate);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

/**
 * Rate limit middleware for admin login
 */
export function rateLimitAdminLogin(c: Context): Response | null {
  const ip = getClientIp(c);
  const key = `admin_login:${ip}`;
  const result = checkRateLimit(key, RATE_LIMITS.adminLogin);

  if (!result.allowed) {
    c.header("Retry-After", String(result.retryAfter || 60));
    return c.json(
      { error: "Too many login attempts. Please try again later." },
      429,
    );
  }

  return null;
}

/**
 * Rate limit middleware for admin routes (per user)
 */
export function rateLimitAdminUser(userId: string): Response | null {
  const key = `admin_user:${userId}`;
  const result = checkRateLimit(key, RATE_LIMITS.adminUser);

  if (!result.allowed) {
    return null; // Let the response be created by the caller with retry-after header
  }

  return null;
}

/**
 * Rate limit middleware for admin routes (per IP)
 */
export function rateLimitAdminIp(c: Context): Response | null {
  const ip = getClientIp(c);
  const key = `admin_ip:${ip}`;
  const result = checkRateLimit(key, RATE_LIMITS.adminIp);

  if (!result.allowed) {
    c.header("Retry-After", String(result.retryAfter || 30));
    return c.json(
      { error: "Too many requests. Please try again later." },
      429,
    );
  }

  return null;
}

/**
 * Combined rate limit check for admin routes
 */
export function checkAdminRateLimits(
  c: Context,
  userId?: string,
): Response | null {
  // Check IP rate limit first
  const ipLimit = rateLimitAdminIp(c);
  if (ipLimit) return ipLimit;

  // Check user rate limit if userId is provided
  if (userId) {
    const userKey = `admin_user:${userId}`;
    const userResult = checkRateLimit(userKey, RATE_LIMITS.adminUser);
    if (!userResult.allowed) {
      c.header("Retry-After", String(userResult.retryAfter || 60));
      return c.json(
        { error: "Too many requests. Please try again later." },
        429,
      );
    }
  }

  return null;
}

/**
 * Reset rate limiter (for testing)
 */
export function resetRateLimiter(): void {
  rateLimitStore.reset();
}

/**
 * Get rate limiter stats (for testing)
 */
export function getRateLimiterStats(): { bucketCount: number } {
  return { bucketCount: rateLimitStore.getBucketCount() };
}

/**
 * Destroy rate limiter (cleanup)
 */
export function destroyRateLimiter(): void {
  rateLimitStore.destroy();
}
