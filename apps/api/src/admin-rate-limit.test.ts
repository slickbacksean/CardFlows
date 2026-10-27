/**
 * Tests for admin rate limiting
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  checkRateLimit,
  resetRateLimiter,
  getRateLimiterStats,
  RATE_LIMITS,
} from "./admin-rate-limit";

describe("Admin Rate Limiting", () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  afterEach(() => {
    resetRateLimiter();
  });

  it("allows requests within rate limit", () => {
    const key = "test:user1";
    const config = { capacity: 5, refillRate: 1 };

    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(key, config);
      expect(result.allowed).toBe(true);
    }

    const stats = getRateLimiterStats();
    expect(stats.bucketCount).toBe(1);
  });

  it("blocks requests exceeding rate limit", () => {
    const key = "test:user1";
    const config = { capacity: 3, refillRate: 1 };

    // Use up all tokens
    for (let i = 0; i < 3; i++) {
      const result = checkRateLimit(key, config);
      expect(result.allowed).toBe(true);
    }

    // Next request should be blocked
    const blocked = checkRateLimit(key, config);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("refills tokens over time", async () => {
    const key = "test:user1";
    const config = { capacity: 2, refillRate: 10 }; // 10 tokens per second

    // Use up all tokens
    checkRateLimit(key, config);
    checkRateLimit(key, config);

    // Should be blocked immediately
    expect(checkRateLimit(key, config).allowed).toBe(false);

    // Wait 300ms (should refill 3 tokens at 10/sec rate, with margin for timing)
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Should allow 2 more requests (capacity is 2, so we get at most 2)
    expect(checkRateLimit(key, config).allowed).toBe(true);
    expect(checkRateLimit(key, config).allowed).toBe(true);
  });

  it("maintains separate buckets per key", () => {
    const config = { capacity: 2, refillRate: 1 };

    // User 1 uses up their tokens
    checkRateLimit("user:1", config);
    checkRateLimit("user:1", config);
    expect(checkRateLimit("user:1", config).allowed).toBe(false);

    // User 2 should still have tokens
    expect(checkRateLimit("user:2", config).allowed).toBe(true);
    expect(checkRateLimit("user:2", config).allowed).toBe(true);

    const stats = getRateLimiterStats();
    expect(stats.bucketCount).toBe(2);
  });

  it("admin login rate limit is strict", () => {
    const key = "admin_login:192.168.1.1";
    
    // Should allow 5 attempts
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(key, RATE_LIMITS.adminLogin);
      expect(result.allowed).toBe(true);
    }

    // 6th attempt should be blocked
    const blocked = checkRateLimit(key, RATE_LIMITS.adminLogin);
    expect(blocked.allowed).toBe(false);
  });

  it("admin user rate limit allows 60 requests", () => {
    const key = "admin_user:user_123";
    
    // Should allow 60 requests
    for (let i = 0; i < 60; i++) {
      const result = checkRateLimit(key, RATE_LIMITS.adminUser);
      expect(result.allowed).toBe(true);
    }

    // 61st request should be blocked
    const blocked = checkRateLimit(key, RATE_LIMITS.adminUser);
    expect(blocked.allowed).toBe(false);
  });

  it("admin IP rate limit allows 120 requests", () => {
    const key = "admin_ip:192.168.1.1";
    
    // Should allow 120 requests
    for (let i = 0; i < 120; i++) {
      const result = checkRateLimit(key, RATE_LIMITS.adminIp);
      expect(result.allowed).toBe(true);
    }

    // 121st request should be blocked
    const blocked = checkRateLimit(key, RATE_LIMITS.adminIp);
    expect(blocked.allowed).toBe(false);
  });

  it("calculates retry-after correctly", () => {
    const key = "test:user1";
    const config = { capacity: 1, refillRate: 0.5 }; // 1 token every 2 seconds

    // Use up the token
    checkRateLimit(key, config);

    // Check retry-after
    const blocked = checkRateLimit(key, config);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.retryAfter).toBeLessThanOrEqual(2);
  });
});
