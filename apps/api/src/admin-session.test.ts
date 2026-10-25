/**
 * Tests for admin session management and CSRF protection
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createSqliteStore } from "./sqlite-store";
import {
  createAdminSession,
  getAdminSession,
  deleteAdminSession,
  deleteAllUserAdminSessions,
  cleanupExpiredAdminSessions,
  validateCsrfToken,
  hashAdminToken,
  isAdminSessionExpired,
} from "./admin-session";
import type { AdminSession } from "./admin-session";

describe("Admin Session Management", () => {
  const store = createSqliteStore({ sqlitePath: ":memory:" });

  beforeEach(async () => {
    // Clean up admin sessions before each test
    const { adminSessions } = await import("./db/schema");
    await store.db.delete(adminSessions);
  });

  it("creates admin session with token and CSRF token", async () => {
    const userId = "user_123";
    const result = await createAdminSession(userId, store);

    expect(result.token).toBeTruthy();
    expect(result.csrfToken).toBeTruthy();
    expect(result.session.userId).toBe(userId);
    expect(result.session.sessionId).toMatch(/^adm_/);
    expect(result.session.tokenHash).toBeTruthy();
    expect(result.session.csrfToken).toBe(result.csrfToken);
  });

  it("retrieves admin session by token", async () => {
    const userId = "user_123";
    const { token } = await createAdminSession(userId, store);

    const session = await getAdminSession(token, store);
    expect(session).toBeTruthy();
    expect(session?.userId).toBe(userId);
  });

  it("returns null for invalid token", async () => {
    const session = await getAdminSession("invalid_token", store);
    expect(session).toBeNull();
  });

  it("returns null for expired session", async () => {
    const userId = "user_123";
    const { token, session } = await createAdminSession(userId, store);

    // Manually set session to expired
    const { adminSessions } = await import("./db/schema");
    await store.db.update(adminSessions)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where({ sessionId: session.sessionId });

    const retrieved = await getAdminSession(token, store);
    expect(retrieved).toBeNull();
  });

  it("deletes admin session", async () => {
    const userId = "user_123";
    const { token } = await createAdminSession(userId, store);

    const deleted = await deleteAdminSession(token, store);
    expect(deleted).toBe(true);

    const session = await getAdminSession(token, store);
    expect(session).toBeNull();
  });

  it("deletes all user admin sessions", async () => {
    const userId = "user_123";
    await createAdminSession(userId, store);
    await createAdminSession(userId, store);
    await createAdminSession("user_456", store);

    const deleted = await deleteAllUserAdminSessions(userId, store);
    expect(deleted).toBe(2);
  });

  it("cleans up expired sessions", async () => {
    const userId = "user_123";
    const { session: session1 } = await createAdminSession(userId, store);
    const { session: session2 } = await createAdminSession(userId, store);

    // Expire session1
    const { adminSessions } = await import("./db/schema");
    await store.db.update(adminSessions)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where({ sessionId: session1.sessionId });

    const cleaned = await cleanupExpiredAdminSessions(store);
    expect(cleaned).toBe(1);

    // Verify session2 still exists
    const { adminSessions: sessions2 } = await import("./db/schema");
    const [remaining] = await store.db.select()
      .from(sessions2)
      .where({ sessionId: session2.sessionId });
    expect(remaining).toBeTruthy();
  });

  it("validates CSRF token correctly", () => {
    const session: AdminSession = {
      sessionId: "test",
      userId: "user_123",
      tokenHash: "hash",
      csrfToken: "csrf_token_123",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    };

    expect(validateCsrfToken(session, "csrf_token_123")).toBe(true);
    expect(validateCsrfToken(session, "wrong_token")).toBe(false);
    expect(validateCsrfToken(session, undefined)).toBe(false);
  });

  it("hashes tokens consistently", () => {
    const token = "test_token";
    const hash1 = hashAdminToken(token);
    const hash2 = hashAdminToken(token);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it("detects expired sessions", () => {
    const now = new Date();
    const expired = new Date(now.getTime() - 1000).toISOString();
    const valid = new Date(now.getTime() + 1000).toISOString();

    expect(isAdminSessionExpired(expired, now)).toBe(true);
    expect(isAdminSessionExpired(valid, now)).toBe(false);
  });
});
