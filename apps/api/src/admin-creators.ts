/**
 * Creator/affiliate tracking
 * Sean (Oct 25): Manage creators, invite codes, and attribution
 */

import { randomBytes } from "node:crypto";
import { eq, sql, desc, and, isNull } from "drizzle-orm";
import type { SqliteStorePort } from "./sqlite-store";
import { creators, creatorStatsSnapshots, userAccounts, crmScans, crmPurchases, crmInventoryItems, gradeAccounts } from "./db/schema";

/**
 * Generate a unique invite code (6 uppercase alphanumeric).
 */
export function generateInviteCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i]! % chars.length];
  }
  return code;
}

/**
 * Create a new creator/affiliate.
 */
export async function createCreator(
  store: SqliteStorePort,
  input: {
    name: string;
    platform: "twitch" | "youtube" | "tiktok" | "instagram" | "twitter" | "facebook" | "other";
    handle: string;
    notes?: string;
    inviteCode?: string;
  },
): Promise<{ creatorId: string; inviteCode: string }> {
  const creatorId = `cr_${randomBytes(16).toString("hex")}`;
  const inviteCode = input.inviteCode || generateInviteCode();
  const now = new Date().toISOString();

  // Check if invite code is already in use
  const existing = await store.db
    .select()
    .from(creators)
    .where(and(eq(creators.inviteCode, inviteCode), isNull(creators.archivedAt)))
    .limit(1);

  if (existing.length > 0) {
    throw new Error(`Invite code ${inviteCode} is already in use`);
  }

  await store.db.insert(creators).values({
    creatorId,
    name: input.name,
    platform: input.platform,
    handle: input.handle,
    inviteCode,
    notes: input.notes || "",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });

  return { creatorId, inviteCode };
}

/**
 * Update a creator's details.
 */
export async function updateCreator(
  store: SqliteStorePort,
  creatorId: string,
  updates: {
    name?: string;
    platform?: "twitch" | "youtube" | "tiktok" | "instagram" | "twitter" | "facebook" | "other";
    handle?: string;
    notes?: string;
  },
): Promise<void> {
  await store.db
    .update(creators)
    .set({
      ...updates,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(creators.creatorId, creatorId));
}

/**
 * Archive a creator (soft delete).
 */
export async function archiveCreator(store: SqliteStorePort, creatorId: string): Promise<void> {
  await store.db
    .update(creators)
    .set({
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(creators.creatorId, creatorId));
}

/**
 * List all creators (active by default).
 */
export async function listCreators(
  store: SqliteStorePort,
  options: { includeArchived?: boolean } = {},
): Promise<Array<{
  creatorId: string;
  name: string;
  platform: string;
  handle: string;
  inviteCode: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}>> {
  let query = store.db.select().from(creators).orderBy(desc(creators.createdAt));

  if (!options.includeArchived) {
    query = query.where(isNull(creators.archivedAt)) as typeof query;
  }

  return query;
}

/**
 * Get creator by invite code.
 */
export async function getCreatorByCode(store: SqliteStorePort, inviteCode: string): Promise<{ creatorId: string; name: string } | null> {
  const [creator] = await store.db
    .select({ creatorId: creators.creatorId, name: creators.name })
    .from(creators)
    .where(and(eq(creators.inviteCode, inviteCode.toUpperCase()), isNull(creators.archivedAt)))
    .limit(1);

  return creator || null;
}

/**
 * Compute real-time creator stats (for immediate display, not cached).
 * Returns metrics: signups, verified, activated (first scan), D7 retention, scans, purchases, premium.
 */
export async function computeCreatorStats(
  store: SqliteStorePort,
  creatorId: string,
): Promise<{
  signupsCount: number;
  verifiedSignupsCount: number;
  activatedUsersCount: number;
  d7RetainedCount: number;
  totalScans: number;
  totalPurchases: number;
  premiumConversions: number;
}> {
  const [creator] = await store.db.select().from(creators).where(eq(creators.creatorId, creatorId)).limit(1);
  if (!creator) throw new Error("Creator not found");

  // All signups with this code
  const signups = await store.db
    .select({ userId: userAccounts.userId, emailVerifiedAt: userAccounts.emailVerifiedAt, createdAt: userAccounts.createdAt })
    .from(userAccounts)
    .where(eq(userAccounts.creatorCode, creator.inviteCode));

  const signupsCount = signups.length;
  const verifiedSignupsCount = signups.filter((s) => s.emailVerifiedAt).length;

  // Activated = users who have scanned at least once
  const userIds = signups.map((s) => s.userId);
  if (userIds.length === 0) {
    return {
      signupsCount: 0,
      verifiedSignupsCount: 0,
      activatedUsersCount: 0,
      d7RetainedCount: 0,
      totalScans: 0,
      totalPurchases: 0,
      premiumConversions: 0,
    };
  }

  const scansPerUser = await store.db
    .select({
      userId: crmScans.userId,
      count: sql<number>`count(*)`.as("count"),
    })
    .from(crmScans)
    .where(sql`${crmScans.userId} IN ${userIds}`)
    .groupBy(crmScans.userId);

  const activatedUsersCount = scansPerUser.length;
  const totalScans = scansPerUser.reduce((sum, row) => sum + row.count, 0);

  // D7 retention: users who scanned within 7 days AND scanned again after day 7
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  let d7RetainedCount = 0;
  for (const signup of signups) {
    const signupDate = new Date(signup.createdAt).getTime();
    const day7 = signupDate + sevenDaysMs;

    const [withinD7] = await store.db
      .select({ count: sql<number>`count(*)` })
      .from(crmScans)
      .where(and(eq(crmScans.userId, signup.userId), sql`datetime(${crmScans.capturedAt}) <= datetime(${new Date(day7).toISOString()})`))
      .limit(1);

    const [afterD7] = await store.db
      .select({ count: sql<number>`count(*)` })
      .from(crmScans)
      .where(and(eq(crmScans.userId, signup.userId), sql`datetime(${crmScans.capturedAt}) > datetime(${new Date(day7).toISOString()})`))
      .limit(1);

    if ((withinD7?.count || 0) > 0 && (afterD7?.count || 0) > 0) {
      d7RetainedCount++;
    }
  }

  // Purchases marked
  const [purchasesResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(crmPurchases)
    .innerJoin(crmInventoryItems, eq(crmPurchases.inventoryItemId, crmInventoryItems.inventoryItemId))
    .where(sql`${crmInventoryItems.userId} IN ${userIds}`)
    .limit(1);

  const totalPurchases = purchasesResult?.count || 0;

  // Premium conversions
  const [premiumResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(gradeAccounts)
    .where(and(sql`${gradeAccounts.userId} IN ${userIds}`, eq(gradeAccounts.plan, "premium")))
    .limit(1);

  const premiumConversions = premiumResult?.count || 0;

  return {
    signupsCount,
    verifiedSignupsCount,
    activatedUsersCount,
    d7RetainedCount,
    totalScans,
    totalPurchases,
    premiumConversions,
  };
}

/**
 * Get leaderboard of creators by a metric.
 */
export async function getCreatorLeaderboard(
  store: SqliteStorePort,
  options: { sortBy?: "signups" | "activated" | "scans" | "purchases"; limit?: number } = {},
): Promise<Array<{
  creatorId: string;
  name: string;
  platform: string;
  handle: string;
  inviteCode: string;
  stats: {
    signupsCount: number;
    activatedUsersCount: number;
    totalScans: number;
    totalPurchases: number;
  };
}>> {
  const allCreators = await listCreators(store, { includeArchived: false });
  const limit = options.limit || 20;

  const leaderboard = await Promise.all(
    allCreators.map(async (creator) => {
      const stats = await computeCreatorStats(store, creator.creatorId);
      return {
        creatorId: creator.creatorId,
        name: creator.name,
        platform: creator.platform,
        handle: creator.handle,
        inviteCode: creator.inviteCode,
        stats: {
          signupsCount: stats.signupsCount,
          activatedUsersCount: stats.activatedUsersCount,
          totalScans: stats.totalScans,
          totalPurchases: stats.totalPurchases,
        },
      };
    }),
  );

  // Sort
  const sortBy = options.sortBy || "signups";
  leaderboard.sort((a, b) => {
    if (sortBy === "signups") return b.stats.signupsCount - a.stats.signupsCount;
    if (sortBy === "activated") return b.stats.activatedUsersCount - a.stats.activatedUsersCount;
    if (sortBy === "scans") return b.stats.totalScans - a.stats.totalScans;
    if (sortBy === "purchases") return b.stats.totalPurchases - a.stats.totalPurchases;
    return 0;
  });

  return leaderboard.slice(0, limit);
}
