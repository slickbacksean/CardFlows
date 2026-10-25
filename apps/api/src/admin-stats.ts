/**
 * Admin dashboard stats
 * Sean (Oct 25): Aggregate statistics for admin dashboard
 */

import { sql, and, gte, lte, eq, isNotNull, isNull, desc } from "drizzle-orm";
import type { SqliteStorePort } from "./sqlite-store";
import {
  userAccounts,
  crmScans,
  crmPurchases,
  crmInventoryItems,
  communityPosts,
  postReactions,
  postComments,
  contentReports,
  vendorQuotaUsage,
} from "./db/schema";

/**
 * User stats: totals, new signups per day/week, DAU/WAU/MAU, D1/D7/D30 retention.
 */
export async function getUserStats(
  store: SqliteStorePort,
  options: { startDate?: string; endDate?: string } = {},
): Promise<{
  totalUsers: number;
  verifiedUsers: number;
  newSignupsToday: number;
  newSignupsThisWeek: number;
  newSignupsThisMonth: number;
  dailyActiveUsers: number;
  weeklyActiveUsers: number;
  monthlyActiveUsers: number;
  d1Retention: number;
  d7Retention: number;
  d30Retention: number;
  signupsByDay: Array<{ date: string; count: number }>;
}> {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Total users
  const [totalUsersResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(userAccounts)
    .limit(1);
  const totalUsers = totalUsersResult?.count || 0;

  // Verified users
  const [verifiedResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(userAccounts)
    .where(isNotNull(userAccounts.emailVerifiedAt))
    .limit(1);
  const verifiedUsers = verifiedResult?.count || 0;

  // New signups (today, this week, this month)
  const [todaySignups] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(userAccounts)
    .where(sql`date(${userAccounts.createdAt}) = date('now')`)
    .limit(1);

  const [weekSignups] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(userAccounts)
    .where(gte(userAccounts.createdAt, weekAgo))
    .limit(1);

  const [monthSignups] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(userAccounts)
    .where(gte(userAccounts.createdAt, monthAgo))
    .limit(1);

  // DAU/WAU/MAU: users who have scanned in the last 1/7/30 days
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [dauResult] = await store.db
    .select({ count: sql<number>`count(DISTINCT ${crmScans.userId})` })
    .from(crmScans)
    .where(gte(crmScans.capturedAt, dayAgo))
    .limit(1);

  const [wauResult] = await store.db
    .select({ count: sql<number>`count(DISTINCT ${crmScans.userId})` })
    .from(crmScans)
    .where(gte(crmScans.capturedAt, weekAgo))
    .limit(1);

  const [mauResult] = await store.db
    .select({ count: sql<number>`count(DISTINCT ${crmScans.userId})` })
    .from(crmScans)
    .where(gte(crmScans.capturedAt, monthAgo))
    .limit(1);

  // Retention: D1/D7/D30 (simplified: users who scanned after day 1/7/30 from signup)
  const d1Retention = await computeRetention(store, 1);
  const d7Retention = await computeRetention(store, 7);
  const d30Retention = await computeRetention(store, 30);

  // Signups by day (last 30 days)
  const signupsByDay = await store.db
    .select({
      date: sql<string>`date(${userAccounts.createdAt})`.as("date"),
      count: sql<number>`count(*)`.as("count"),
    })
    .from(userAccounts)
    .where(gte(userAccounts.createdAt, monthAgo))
    .groupBy(sql`date(${userAccounts.createdAt})`)
    .orderBy(sql`date(${userAccounts.createdAt})`);

  return {
    totalUsers,
    verifiedUsers,
    newSignupsToday: todaySignups?.count || 0,
    newSignupsThisWeek: weekSignups?.count || 0,
    newSignupsThisMonth: monthSignups?.count || 0,
    dailyActiveUsers: dauResult?.count || 0,
    weeklyActiveUsers: wauResult?.count || 0,
    monthlyActiveUsers: mauResult?.count || 0,
    d1Retention,
    d7Retention,
    d30Retention,
    signupsByDay,
  };
}

/**
 * Compute retention: % of users who scanned after N days from signup.
 */
async function computeRetention(store: SqliteStorePort, days: number): Promise<number> {
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Users who signed up before the cutoff
  const [cohortResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(userAccounts)
    .where(lte(userAccounts.createdAt, cutoffDate))
    .limit(1);

  const cohortSize = cohortResult?.count || 0;
  if (cohortSize === 0) return 0;

  // Users from that cohort who scanned after day N
  const [retainedResult] = await store.db
    .select({ count: sql<number>`count(DISTINCT ${userAccounts.userId})` })
    .from(userAccounts)
    .innerJoin(crmScans, eq(userAccounts.userId, crmScans.userId))
    .where(
      and(
        lte(userAccounts.createdAt, cutoffDate),
        sql`datetime(${crmScans.capturedAt}) > datetime(${userAccounts.createdAt}, '+${days} days')`,
      ),
    )
    .limit(1);

  const retained = retainedResult?.count || 0;
  return Math.round((retained / cohortSize) * 100);
}

/**
 * Scan stats: scans per day, recognition success rate, CardSight usage.
 */
export async function getScanStats(
  store: SqliteStorePort,
): Promise<{
  totalScans: number;
  scansToday: number;
  scansThisWeek: number;
  scansThisMonth: number;
  recognitionSuccessRate: number;
  cardsightUsageThisMonth: number;
  cardsightMonthlyCap: number;
  scansByDay: Array<{ date: string; count: number }>;
}> {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [totalResult] = await store.db.select({ count: sql<number>`count(*)` }).from(crmScans).limit(1);

  const [todayResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(crmScans)
    .where(sql`date(${crmScans.capturedAt}) = date('now')`)
    .limit(1);

  const [weekResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(crmScans)
    .where(gte(crmScans.capturedAt, weekAgo))
    .limit(1);

  const [monthResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(crmScans)
    .where(gte(crmScans.capturedAt, monthAgo))
    .limit(1);

  // Recognition success: scans with mappingStatus = 'mapped'
  const [successResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(crmScans)
    .where(eq(crmScans.mappingStatus, "mapped"))
    .limit(1);

  const successRate = totalResult?.count ? Math.round(((successResult?.count || 0) / totalResult.count) * 100) : 0;

  // CardSight usage this month
  const [cardsightResult] = await store.db
    .select({ used: vendorQuotaUsage.used })
    .from(vendorQuotaUsage)
    .where(and(eq(vendorQuotaUsage.provider, "cardsight"), eq(vendorQuotaUsage.monthKey, monthKey)))
    .limit(1);

  const cardsightUsageThisMonth = cardsightResult?.used || 0;
  const cardsightMonthlyCap = 750; // From env or default

  // Scans by day
  const scansByDay = await store.db
    .select({
      date: sql<string>`date(${crmScans.capturedAt})`.as("date"),
      count: sql<number>`count(*)`.as("count"),
    })
    .from(crmScans)
    .where(gte(crmScans.capturedAt, monthAgo))
    .groupBy(sql`date(${crmScans.capturedAt})`)
    .orderBy(sql`date(${crmScans.capturedAt})`);

  return {
    totalScans: totalResult?.count || 0,
    scansToday: todayResult?.count || 0,
    scansThisWeek: weekResult?.count || 0,
    scansThisMonth: monthResult?.count || 0,
    recognitionSuccessRate: successRate,
    cardsightUsageThisMonth,
    cardsightMonthlyCap,
    scansByDay,
  };
}

/**
 * Purchase and collection stats.
 */
export async function getPurchaseStats(
  store: SqliteStorePort,
): Promise<{
  totalPurchases: number;
  purchasesToday: number;
  purchasesThisWeek: number;
  purchasesThisMonth: number;
  totalCollectionValueCents: number;
  purchasesByDay: Array<{ date: string; count: number }>;
}> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [totalResult] = await store.db.select({ count: sql<number>`count(*)` }).from(crmPurchases).limit(1);

  const [todayResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(crmPurchases)
    .where(sql`date(${crmPurchases.purchasedAt}) = date('now')`)
    .limit(1);

  const [weekResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(crmPurchases)
    .where(gte(crmPurchases.purchasedAt, weekAgo))
    .limit(1);

  const [monthResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(crmPurchases)
    .where(gte(crmPurchases.purchasedAt, monthAgo))
    .limit(1);

  // Total collection value (sum of all-in costs)
  const [valueResult] = await store.db
    .select({ total: sql<number>`COALESCE(sum(${crmPurchases.allInTotal}), 0)` })
    .from(crmPurchases)
    .limit(1);

  // Purchases by day
  const purchasesByDay = await store.db
    .select({
      date: sql<string>`date(${crmPurchases.purchasedAt})`.as("date"),
      count: sql<number>`count(*)`.as("count"),
    })
    .from(crmPurchases)
    .where(gte(crmPurchases.purchasedAt, monthAgo))
    .groupBy(sql`date(${crmPurchases.purchasedAt})`)
    .orderBy(sql`date(${crmPurchases.purchasedAt})`);

  return {
    totalPurchases: totalResult?.count || 0,
    purchasesToday: todayResult?.count || 0,
    purchasesThisWeek: weekResult?.count || 0,
    purchasesThisMonth: monthResult?.count || 0,
    totalCollectionValueCents: valueResult?.total || 0,
    purchasesByDay,
  };
}

/**
 * Community activity stats.
 */
export async function getCommunityStats(
  store: SqliteStorePort,
): Promise<{
  totalPosts: number;
  postsToday: number;
  postsThisWeek: number;
  totalReactions: number;
  totalComments: number;
  pendingReports: number;
  postsByDay: Array<{ date: string; count: number }>;
}> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [totalResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(communityPosts)
    .where(and(isNull(communityPosts.hiddenAt), isNull(communityPosts.removedAt)))
    .limit(1);

  const [todayResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(communityPosts)
    .where(and(sql`date(${communityPosts.createdAt}) = date('now')`, isNull(communityPosts.hiddenAt), isNull(communityPosts.removedAt)))
    .limit(1);

  const [weekResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(communityPosts)
    .where(and(gte(communityPosts.createdAt, weekAgo), isNull(communityPosts.hiddenAt), isNull(communityPosts.removedAt)))
    .limit(1);

  const [reactionsResult] = await store.db.select({ count: sql<number>`count(*)` }).from(postReactions).limit(1);

  const [commentsResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(postComments)
    .where(and(isNull(postComments.hiddenAt), isNull(postComments.removedAt)))
    .limit(1);

  const [reportsResult] = await store.db
    .select({ count: sql<number>`count(*)` })
    .from(contentReports)
    .where(isNull(contentReports.resolvedAt))
    .limit(1);

  // Posts by day
  const postsByDay = await store.db
    .select({
      date: sql<string>`date(${communityPosts.createdAt})`.as("date"),
      count: sql<number>`count(*)`.as("count"),
    })
    .from(communityPosts)
    .where(and(gte(communityPosts.createdAt, monthAgo), isNull(communityPosts.hiddenAt), isNull(communityPosts.removedAt)))
    .groupBy(sql`date(${communityPosts.createdAt})`)
    .orderBy(sql`date(${communityPosts.createdAt})`);

  return {
    totalPosts: totalResult?.count || 0,
    postsToday: todayResult?.count || 0,
    postsThisWeek: weekResult?.count || 0,
    totalReactions: reactionsResult?.count || 0,
    totalComments: commentsResult?.count || 0,
    pendingReports: reportsResult?.count || 0,
    postsByDay,
  };
}
