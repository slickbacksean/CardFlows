/**
 * Admin session management with CSRF protection
 * Sean (Oct 25): Secure admin sessions with 8-hour TTL, CSRF tokens, and rate limiting
 */

import { createHash, randomBytes } from "node:crypto";
import type { Context } from "hono";
import { eq, and, lt } from "drizzle-orm";
import type { SqliteStorePort } from "./sqlite-store";

export const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

export interface AdminSession {
  sessionId: string;
  userId: string;
  tokenHash: string;
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
}

export interface AdminSessionTable {
  sessionId: string;
  userId: string;
  tokenHash: string;
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Hash an admin session token for storage
 */
export function hashAdminToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Generate a secure random token
 */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Generate a CSRF token
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Get admin session expiry timestamp
 */
export function getAdminSessionExpiry(createdAt = new Date()): string {
  return new Date(createdAt.getTime() + ADMIN_SESSION_TTL_MS).toISOString();
}

/**
 * Check if a session is expired
 */
export function isAdminSessionExpired(expiresAt: string, now = new Date()): boolean {
  return Date.parse(expiresAt) <= now.getTime();
}

/**
 * Create a new admin session
 */
export async function createAdminSession(
  userId: string,
  store: SqliteStorePort,
): Promise<{ token: string; csrfToken: string; session: AdminSession }> {
  const sessionId = `adm_${randomBytes(16).toString("hex")}`;
  const token = generateToken();
  const tokenHash = hashAdminToken(token);
  const csrfToken = generateCsrfToken();
  const createdAt = new Date().toISOString();
  const expiresAt = getAdminSessionExpiry();

  const session: AdminSession = {
    sessionId,
    userId,
    tokenHash,
    csrfToken,
    createdAt,
    expiresAt,
  };

  // Import schema dynamically to avoid circular dependencies
  const { adminSessions } = await import("./db/schema");
  
  await store.db.insert(adminSessions).values(session);

  return { token, csrfToken, session };
}

/**
 * Get admin session by token
 */
export async function getAdminSession(
  token: string,
  store: SqliteStorePort,
): Promise<AdminSession | null> {
  const tokenHash = hashAdminToken(token);
  const { adminSessions } = await import("./db/schema");
  
  const [session] = await store.db
    .select()
    .from(adminSessions)
    .where(eq(adminSessions.tokenHash, tokenHash))
    .limit(1);

  if (!session || isAdminSessionExpired(session.expiresAt)) {
    return null;
  }

  return session;
}

/**
 * Delete an admin session (logout)
 */
export async function deleteAdminSession(
  token: string,
  store: SqliteStorePort,
): Promise<boolean> {
  const tokenHash = hashAdminToken(token);
  const { adminSessions } = await import("./db/schema");
  
  const result = await store.db
    .delete(adminSessions)
    .where(eq(adminSessions.tokenHash, tokenHash));

  return (result.changes || 0) > 0;
}

/**
 * Delete all admin sessions for a user
 */
export async function deleteAllUserAdminSessions(
  userId: string,
  store: SqliteStorePort,
): Promise<number> {
  const { adminSessions } = await import("./db/schema");
  
  const result = await store.db
    .delete(adminSessions)
    .where(eq(adminSessions.userId, userId));

  return result.changes || 0;
}

/**
 * Clean up expired admin sessions
 */
export async function cleanupExpiredAdminSessions(
  store: SqliteStorePort,
): Promise<number> {
  const now = new Date().toISOString();
  const { adminSessions } = await import("./db/schema");
  
  const result = await store.db
    .delete(adminSessions)
    .where(lt(adminSessions.expiresAt, now));

  return result.changes || 0;
}

/**
 * Validate CSRF token
 */
export function validateCsrfToken(
  session: AdminSession,
  providedToken: string | undefined,
): boolean {
  if (!providedToken) return false;
  return session.csrfToken === providedToken;
}

/**
 * Validate Origin or Referer header for CSRF protection
 */
export function validateOriginOrReferer(
  c: Context,
  allowedOrigins: string[] = [],
): boolean {
  const origin = c.req.header("origin");
  const referer = c.req.header("referer");

  // If no allowed origins specified, allow any origin from the same host
  if (allowedOrigins.length === 0) {
    const host = c.req.header("host");
    if (!host) return false;
    
    if (origin) {
      try {
        const originUrl = new URL(origin);
        return originUrl.host === host;
      } catch {
        return false;
      }
    }
    
    if (referer) {
      try {
        const refererUrl = new URL(referer);
        return refererUrl.host === host;
      } catch {
        return false;
      }
    }
    
    return false;
  }

  // Check against allowed origins
  if (origin && allowedOrigins.includes(origin)) return true;
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
      return allowedOrigins.includes(refererOrigin);
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Parse admin session token from cookie
 */
export function parseAdminSessionCookie(c: Context): string | null {
  const cookie = c.req.header("cookie");
  if (!cookie) return null;

  const match = /(?:^|;\s*)admin_session=([^;]+)/.exec(cookie);
  return match?.[1] || null;
}

/**
 * Set admin session cookie
 */
export function setAdminSessionCookie(
  c: Context,
  token: string,
  maxAge: number = ADMIN_SESSION_TTL_MS / 1000,
): void {
  c.header(
    "Set-Cookie",
    `admin_session=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}; Path=/`,
  );
}

/**
 * Clear admin session cookie
 */
export function clearAdminSessionCookie(c: Context): void {
  c.header(
    "Set-Cookie",
    "admin_session=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/",
  );
}

/**
 * Require admin session with CSRF validation for state-changing operations
 */
export async function requireAdminSession(
  c: Context,
  store: SqliteStorePort,
  options: { requireCsrf?: boolean; allowedOrigins?: string[] } = {},
): Promise<{ ok: true; session: AdminSession; userId: string } | { ok: false; response: Response }> {
  const { requireCsrf = false, allowedOrigins = [] } = options;

  // Get session token from cookie
  const token = parseAdminSessionCookie(c);
  if (!token) {
    return { ok: false, response: c.json({ error: "Admin authentication required" }, 401) };
  }

  // Validate session
  const session = await getAdminSession(token, store);
  if (!session) {
    return { ok: false, response: c.json({ error: "Invalid or expired admin session" }, 401) };
  }

  // Check if user still has admin role
  const { isAdmin } = await import("./admin-auth");
  const admin = await isAdmin(session.userId, store);
  if (!admin) {
    return { ok: false, response: c.json({ error: "Admin access required" }, 403) };
  }

  // CSRF protection for state-changing operations
  if (requireCsrf) {
    // Validate Origin/Referer
    if (!validateOriginOrReferer(c, allowedOrigins)) {
      return { ok: false, response: c.json({ error: "Invalid origin or referer" }, 403) };
    }

    // Validate CSRF token (from header or body)
    const csrfToken = c.req.header("x-csrf-token");
    if (!validateCsrfToken(session, csrfToken)) {
      return { ok: false, response: c.json({ error: "Invalid CSRF token" }, 403) };
    }
  }

  return { ok: true, session, userId: session.userId };
}
