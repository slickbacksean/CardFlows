/**
 * Admin authentication and authorization
 * Sean (Oct 25): Server-side role checking with audit logging
 */

import type { Context } from "hono";
import { eq, sql } from "drizzle-orm";
import { userAccounts, adminActions } from "./db/schema";
import type { SqliteStorePort } from "./sqlite-store";
import { randomBytes } from "node:crypto";

/** Admin user IDs from env var (comma-separated). */
export function adminUserIdsFromEnv(env: Record<string, string | undefined> = process.env): Set<string> {
  const ids = env.ADMIN_USER_IDS?.split(",").map((s) => s.trim()).filter(Boolean) || [];
  return new Set(ids);
}

/** Admin emails from env var (comma-separated, case-insensitive). */
export function adminEmailsFromEnv(env: Record<string, string | undefined> = process.env): Set<string> {
  const emails = env.ADMIN_EMAILS?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) || [];
  return new Set(emails);
}

/**
 * Bootstrap admin roles: grant 'admin' to users in ADMIN_USER_IDS or ADMIN_EMAILS.
 * Run once at startup and whenever env vars change. Idempotent.
 */
export async function bootstrapAdminRoles(store: SqliteStorePort, env: Record<string, string | undefined> = process.env): Promise<{ granted: number }> {
  const userIds = adminUserIdsFromEnv(env);
  const emails = adminEmailsFromEnv(env);

  if (userIds.size === 0 && emails.size === 0) return { granted: 0 };

  let granted = 0;

  // Grant by user ID
  if (userIds.size > 0) {
    const result = await store.db
      .update(userAccounts)
      .set({ role: "admin" })
      .where(sql`${userAccounts.userId} IN ${Array.from(userIds)} AND ${userAccounts.role} != 'admin'`);
    granted += result.changes || 0;
  }

  // Grant by email (case-insensitive)
  if (emails.size > 0) {
    const result = await store.db
      .update(userAccounts)
      .set({ role: "admin" })
      .where(sql`LOWER(${userAccounts.email}) IN ${Array.from(emails)} AND ${userAccounts.role} != 'admin'`);
    granted += result.changes || 0;
  }

  return { granted };
}

/**
 * Check if a user is an admin (has 'admin' role).
 * Returns true if admin, false otherwise.
 */
export async function isAdmin(userId: string, store: SqliteStorePort): Promise<boolean> {
  const [user] = await store.db
    .select({ role: userAccounts.role })
    .from(userAccounts)
    .where(eq(userAccounts.userId, userId))
    .limit(1);

  return user?.role === "admin";
}

/**
 * Require admin role. Returns 403 if not admin.
 * Use in route handlers: `const requireAdmin = await requireAdminRole(c, store); if (!requireAdmin.ok) return requireAdmin.response;`
 */
export async function requireAdminRole(
  c: Context,
  store: SqliteStorePort,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const userId = c.get("userId") as string | undefined;
  if (!userId) {
    return { ok: false, response: c.json({ error: "Authentication required" }, 401) };
  }

  const admin = await isAdmin(userId, store);
  if (!admin) {
    return { ok: false, response: c.json({ error: "Admin access required" }, 403) };
  }

  return { ok: true, userId };
}

/**
 * Log an admin action to the audit trail.
 */
export async function logAdminAction(
  store: SqliteStorePort,
  input: {
    adminUserId: string;
    actionType: "report_resolve" | "content_remove" | "user_suspend" | "user_ban" | "creator_create" | "creator_update" | "creator_delete" | "stats_export" | "admin_grant" | "admin_revoke";
    targetType?: string;
    targetId?: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const actionId = `aa_${randomBytes(16).toString("hex")}`;
  await store.db.insert(adminActions).values({
    actionId,
    adminUserId: input.adminUserId,
    actionType: input.actionType,
    targetType: input.targetType || null,
    targetId: input.targetId || null,
    detailsJson: JSON.stringify(input.details || {}),
    createdAt: new Date().toISOString(),
  });
}

/**
 * Get recent admin actions for the audit log.
 */
export async function getAdminActions(
  store: SqliteStorePort,
  options: { limit?: number; offset?: number; adminUserId?: string; actionType?: string } = {},
): Promise<Array<{
  actionId: string;
  adminUserId: string;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  detailsJson: string;
  createdAt: string;
}>> {
  const limit = Math.min(options.limit || 100, 500);
  const offset = options.offset || 0;

  let query = store.db.select().from(adminActions).orderBy(sql`${adminActions.createdAt} DESC`).limit(limit).offset(offset);

  if (options.adminUserId) {
    query = query.where(eq(adminActions.adminUserId, options.adminUserId)) as typeof query;
  }

  if (options.actionType) {
    query = query.where(eq(adminActions.actionType, options.actionType)) as typeof query;
  }

  return query;
}
