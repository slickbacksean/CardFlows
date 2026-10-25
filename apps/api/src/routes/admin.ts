/**
 * Admin API routes
 * Sean (Oct 25): Admin dashboard, creator tracking, and audit log endpoints
 * Sean (Oct 25): Added CSRF protection, rate limiting, and session management
 */

import type { Context } from "hono";
import type { SqliteStorePort } from "../sqlite-store";
import { requireAdminRole, logAdminAction, getAdminActions, isAdmin } from "../admin-auth";
import { getUserStats, getScanStats, getPurchaseStats, getCommunityStats } from "../admin-stats";
import {
  createCreator,
  updateCreator,
  archiveCreator,
  listCreators,
  computeCreatorStats,
  getCreatorLeaderboard,
} from "../admin-creators";
import {
  createAdminSession,
  deleteAdminSession,
  requireAdminSession,
  setAdminSessionCookie,
  clearAdminSessionCookie,
} from "../admin-session";
import {
  rateLimitAdminLogin,
  checkAdminRateLimits,
} from "../admin-rate-limit";

/**
 * POST /v1/admin/login
 * Create admin session for authenticated admin user.
 * Requires regular user authentication, checks admin role, then creates admin session.
 */
export async function adminLogin(c: Context, store: SqliteStorePort): Promise<Response> {
  // Rate limit login attempts
  const rateLimitResponse = rateLimitAdminLogin(c);
  if (rateLimitResponse) return rateLimitResponse;

  // Check regular user authentication
  const userId = c.get("userId") as string | undefined;
  if (!userId) {
    return c.json({ error: "Authentication required" }, 401);
  }

  // Check admin role
  const admin = await isAdmin(userId, store);
  if (!admin) {
    return c.json({ error: "Admin access required" }, 403);
  }

  // Create admin session
  const { token, csrfToken, session } = await createAdminSession(userId, store);

  // Set secure cookie
  setAdminSessionCookie(c, token);

  // Log admin action
  await logAdminAction(store, {
    adminUserId: userId,
    actionType: "admin_grant",
    details: { action: "login" },
  });

  return c.json({
    success: true,
    csrfToken,
    expiresAt: session.expiresAt,
  });
}

/**
 * POST /v1/admin/logout
 * Logout admin and clear session.
 */
export async function adminLogout(c: Context, store: SqliteStorePort): Promise<Response> {
  const auth = await requireAdminSession(c, store);
  if (!auth.ok) return auth.response;

  // Delete session
  const token = c.req.header("cookie")?.match(/admin_session=([^;]+)/)?.[1];
  if (token) {
    await deleteAdminSession(token, store);
  }

  // Clear cookie
  clearAdminSessionCookie(c);

  // Log admin action
  await logAdminAction(store, {
    adminUserId: auth.userId,
    actionType: "admin_revoke",
    details: { action: "logout" },
  });

  return c.json({ success: true });
}

/**
 * GET /v1/admin/check
 * Check if current user is an admin.
 */
export async function checkAdminStatus(c: Context, store: SqliteStorePort): Promise<Response> {
  const userId = c.get("userId") as string | undefined;
  if (!userId) {
    return c.json({ isAdmin: false });
  }

  const admin = await isAdmin(userId, store);

  return c.json({ isAdmin: admin });
}

/**
 * GET /v1/admin/stats/dashboard
 * Get all dashboard stats in one call.
 */
export async function getDashboardStats(c: Context, store: SqliteStorePort): Promise<Response> {
  // Check rate limits
  const rateLimitResponse = checkAdminRateLimits(c);
  if (rateLimitResponse) return rateLimitResponse;

  const auth = await requireAdminRole(c, store);
  if (!auth.ok) return auth.response;

  // Additional rate limit per user
  const userRateLimit = checkAdminRateLimits(c, auth.userId);
  if (userRateLimit) return userRateLimit;

  const [userStats, scanStats, purchaseStats, communityStats] = await Promise.all([
    getUserStats(store),
    getScanStats(store),
    getPurchaseStats(store),
    getCommunityStats(store),
  ]);

  return c.json({
    users: userStats,
    scans: scanStats,
    purchases: purchaseStats,
    community: communityStats,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * GET /v1/admin/stats/users
 * Get detailed user stats.
 */
export async function getAdminUserStats(c: Context, store: SqliteStorePort): Promise<Response> {
  const auth = await requireAdminRole(c, store);
  if (!auth.ok) return auth.response;

  const stats = await getUserStats(store);
  return c.json(stats);
}

/**
 * GET /v1/admin/stats/scans
 * Get detailed scan stats.
 */
export async function getAdminScanStats(c: Context, store: SqliteStorePort): Promise<Response> {
  const auth = await requireAdminRole(c, store);
  if (!auth.ok) return auth.response;

  const stats = await getScanStats(store);
  return c.json(stats);
}

/**
 * GET /v1/admin/stats/purchases
 * Get detailed purchase stats.
 */
export async function getAdminPurchaseStats(c: Context, store: SqliteStorePort): Promise<Response> {
  const auth = await requireAdminRole(c, store);
  if (!auth.ok) return auth.response;

  const stats = await getPurchaseStats(store);
  return c.json(stats);
}

/**
 * GET /v1/admin/stats/community
 * Get detailed community stats.
 */
export async function getAdminCommunityStats(c: Context, store: SqliteStorePort): Promise<Response> {
  const auth = await requireAdminRole(c, store);
  if (!auth.ok) return auth.response;

  const stats = await getCommunityStats(store);
  return c.json(stats);
}

/**
 * POST /v1/admin/creators
 * Create a new creator/affiliate.
 * Body: { name, platform, handle, notes?, inviteCode? }
 */
export async function createAdminCreator(c: Context, store: SqliteStorePort): Promise<Response> {
  // Check rate limits
  const rateLimitResponse = checkAdminRateLimits(c);
  if (rateLimitResponse) return rateLimitResponse;

  // Require admin session with CSRF protection
  const auth = await requireAdminSession(c, store, { requireCsrf: true });
  if (!auth.ok) return auth.response;

  // Additional rate limit per user
  const userRateLimit = checkAdminRateLimits(c, auth.userId);
  if (userRateLimit) return userRateLimit;

  const body = await c.req.json();
  const { name, platform, handle, notes, inviteCode } = body;

  if (!name || !platform || !handle) {
    return c.json({ error: "name, platform, and handle are required" }, 400);
  }

  const validPlatforms = ["twitch", "youtube", "tiktok", "instagram", "twitter", "facebook", "other"];
  if (!validPlatforms.includes(platform)) {
    return c.json({ error: `Invalid platform. Must be one of: ${validPlatforms.join(", ")}` }, 400);
  }

  try {
    const result = await createCreator(store, { name, platform, handle, notes, inviteCode });

    await logAdminAction(store, {
      adminUserId: auth.userId,
      actionType: "creator_create",
      targetType: "creator",
      targetId: result.creatorId,
      details: { name, platform, handle, inviteCode: result.inviteCode },
    });

    return c.json(result, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to create creator" }, 400);
  }
}

/**
 * GET /v1/admin/creators
 * List all creators.
 */
export async function listAdminCreators(c: Context, store: SqliteStorePort): Promise<Response> {
  const auth = await requireAdminRole(c, store);
  if (!auth.ok) return auth.response;

  const includeArchived = c.req.query("includeArchived") === "true";
  const creators = await listCreators(store, { includeArchived });

  return c.json({ creators });
}

/**
 * GET /v1/admin/creators/:creatorId
 * Get creator details with stats.
 */
export async function getAdminCreator(c: Context, store: SqliteStorePort): Promise<Response> {
  const auth = await requireAdminRole(c, store);
  if (!auth.ok) return auth.response;

  const creatorId = c.req.param("creatorId");
  if (!creatorId) return c.json({ error: "Creator ID required" }, 400);
  
  const creators = await listCreators(store, { includeArchived: true });
  const creator = creators.find((c) => c.creatorId === creatorId);

  if (!creator) {
    return c.json({ error: "Creator not found" }, 404);
  }

  const stats = await computeCreatorStats(store, creatorId);

  return c.json({
    ...creator,
    stats,
  });
}

/**
 * PUT /v1/admin/creators/:creatorId
 * Update a creator.
 * Body: { name?, platform?, handle?, notes? }
 */
export async function updateAdminCreator(c: Context, store: SqliteStorePort): Promise<Response> {
  // Check rate limits
  const rateLimitResponse = checkAdminRateLimits(c);
  if (rateLimitResponse) return rateLimitResponse;

  // Require admin session with CSRF protection
  const auth = await requireAdminSession(c, store, { requireCsrf: true });
  if (!auth.ok) return auth.response;

  // Additional rate limit per user
  const userRateLimit = checkAdminRateLimits(c, auth.userId);
  if (userRateLimit) return userRateLimit;

  const creatorId = c.req.param("creatorId");
  if (!creatorId) return c.json({ error: "Creator ID required" }, 400);
  
  const body = await c.req.json();

  await updateCreator(store, creatorId, body);

  await logAdminAction(store, {
    adminUserId: auth.userId,
    actionType: "creator_update",
    targetType: "creator",
    targetId: creatorId,
    details: body,
  });

  return c.json({ success: true });
}

/**
 * DELETE /v1/admin/creators/:creatorId
 * Archive a creator.
 */
export async function deleteAdminCreator(c: Context, store: SqliteStorePort): Promise<Response> {
  // Check rate limits
  const rateLimitResponse = checkAdminRateLimits(c);
  if (rateLimitResponse) return rateLimitResponse;

  // Require admin session with CSRF protection
  const auth = await requireAdminSession(c, store, { requireCsrf: true });
  if (!auth.ok) return auth.response;

  // Additional rate limit per user
  const userRateLimit = checkAdminRateLimits(c, auth.userId);
  if (userRateLimit) return userRateLimit;

  const creatorId = c.req.param("creatorId");
  if (!creatorId) return c.json({ error: "Creator ID required" }, 400);

  await archiveCreator(store, creatorId);

  await logAdminAction(store, {
    adminUserId: auth.userId,
    actionType: "creator_delete",
    targetType: "creator",
    targetId: creatorId,
  });

  return c.json({ success: true });
}

/**
 * GET /v1/admin/creators/leaderboard
 * Get creator leaderboard.
 */
export async function getAdminCreatorLeaderboard(c: Context, store: SqliteStorePort): Promise<Response> {
  const auth = await requireAdminRole(c, store);
  if (!auth.ok) return auth.response;

  const sortBy = (c.req.query("sortBy") as "signups" | "activated" | "scans" | "purchases" | undefined) || "signups";
  const limit = parseInt(c.req.query("limit") || "20", 10);

  const leaderboard = await getCreatorLeaderboard(store, { sortBy, limit });

  return c.json({ leaderboard });
}

/**
 * GET /v1/admin/creators/:creatorId/export
 * Export creator stats as CSV.
 */
export async function exportCreatorStats(c: Context, store: SqliteStorePort): Promise<Response> {
  const auth = await requireAdminRole(c, store);
  if (!auth.ok) return auth.response;

  const creatorId = c.req.param("creatorId");
  if (!creatorId) return c.json({ error: "Creator ID required" }, 400);
  
  const creators = await listCreators(store, { includeArchived: true });
  const creator = creators.find((c) => c.creatorId === creatorId);

  if (!creator) {
    return c.json({ error: "Creator not found" }, 404);
  }

  const stats = await computeCreatorStats(store, creatorId);

  const csv = [
    "Metric,Value",
    `Creator Name,${creator.name}`,
    `Platform,${creator.platform}`,
    `Handle,${creator.handle}`,
    `Invite Code,${creator.inviteCode}`,
    `Total Signups,${stats.signupsCount}`,
    `Verified Signups,${stats.verifiedSignupsCount}`,
    `Activated Users,${stats.activatedUsersCount}`,
    `D7 Retained,${stats.d7RetainedCount}`,
    `Total Scans,${stats.totalScans}`,
    `Total Purchases,${stats.totalPurchases}`,
    `Premium Conversions,${stats.premiumConversions}`,
  ].join("\n");

  await logAdminAction(store, {
    adminUserId: auth.userId,
    actionType: "stats_export",
    targetType: "creator",
    targetId: creatorId,
  });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="creator-${creator.inviteCode}-stats.csv"`,
    },
  });
}

/**
 * GET /v1/admin/audit-log
 * Get admin action audit log.
 */
export async function getAdminAuditLog(c: Context, store: SqliteStorePort): Promise<Response> {
  const auth = await requireAdminRole(c, store);
  if (!auth.ok) return auth.response;

  const limit = parseInt(c.req.query("limit") || "100", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const adminUserId = c.req.query("adminUserId");
  const actionType = c.req.query("actionType");

  const actions = await getAdminActions(store, { limit, offset, adminUserId, actionType });

  return c.json({ actions });
}
