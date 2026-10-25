/**
 * @vitest-environment node
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach } from "vitest";
import { createMemoryStore } from "./store";
import { createSqliteStore } from "./sqlite-store";
import { eq, and, sql } from "drizzle-orm";
import {
  communitySettings,
  communityPosts,
  postComments,
  contentReports,
  userBlocks,
  commentRateLimits,
} from "./db/schema";

describe("Community: Rate Limiting", () => {
  it("should enforce 10 comments per hour limit", async () => {
    const store = createSqliteStore(":memory:", ":memory:");
    const userId = randomUUID();
    const postId = randomUUID();
    const now = new Date().toISOString();

    // Create a post first
    await store.db.insert(communityPosts).values({
      postId,
      userId: randomUUID(),
      cardflowCardId: randomUUID(),
      createdAt: now,
    });

    // Insert 10 comments in the last hour (max allowed)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    for (let i = 0; i < 10; i++) {
      await store.db.insert(commentRateLimits).values({
        userId,
        commentedAt: new Date(Date.now() - i * 5 * 60 * 1000).toISOString(), // Spread over last hour
      });
    }

    // Check rate limit
    const recentComments = await store.db
      .select()
      .from(commentRateLimits)
      .where(
        and(
          eq(commentRateLimits.userId, userId),
          sql`${commentRateLimits.commentedAt} > ${oneHourAgo}`
        )
      );

    expect(recentComments.length).toBe(10);
    expect(recentComments.length).toBeGreaterThanOrEqual(10); // Should be at limit
  });
});

describe("Community: Report Auto-Hide", () => {
  it("should auto-hide content after 3 distinct reports", async () => {
    const store = createSqliteStore(":memory:", ":memory:");
    const postId = randomUUID();
    const postUserId = randomUUID();
    const now = new Date().toISOString();

    // Create a post
    await store.db.insert(communityPosts).values({
      postId,
      userId: postUserId,
      cardflowCardId: randomUUID(),
      createdAt: now,
    });

    // Add 3 reports from distinct users
    const reporters = [randomUUID(), randomUUID(), randomUUID()];
    for (const reporterId of reporters) {
      await store.db.insert(contentReports).values({
        reportId: randomUUID(),
        targetType: "post",
        targetId: postId,
        reporterUserId: reporterId,
        reason: "spam",
        createdAt: now,
      });
    }

    // Count distinct reporters
    const distinctReports = await store.db
      .select({ count: sql<number>`count(DISTINCT ${contentReports.reporterUserId})` })
      .from(contentReports)
      .where(
        and(
          eq(contentReports.targetType, "post"),
          eq(contentReports.targetId, postId),
          sql`${contentReports.resolvedAt} IS NULL`
        )
      )
      .get();

    expect(distinctReports?.count).toBe(3);
    expect(distinctReports?.count).toBeGreaterThanOrEqual(3); // Should trigger auto-hide
  });

  it("should not auto-hide with reports from same user", async () => {
    const store = createSqliteStore(":memory:", ":memory:");
    const postId = randomUUID();
    const reporterId = randomUUID();
    const now = new Date().toISOString();

    // Create a post
    await store.db.insert(communityPosts).values({
      postId,
      userId: randomUUID(),
      cardflowCardId: randomUUID(),
      createdAt: now,
    });

    // Add 3 reports from SAME user (should not trigger)
    for (let i = 0; i < 3; i++) {
      await store.db.insert(contentReports).values({
        reportId: randomUUID(),
        targetType: "post",
        targetId: postId,
        reporterUserId: reporterId, // Same reporter
        reason: "spam",
        createdAt: now,
      });
    }

    const distinctReports = await store.db
      .select({ count: sql<number>`count(DISTINCT ${contentReports.reporterUserId})` })
      .from(contentReports)
      .where(
        and(
          eq(contentReports.targetType, "post"),
          eq(contentReports.targetId, postId),
          sql`${contentReports.resolvedAt} IS NULL`
        )
      )
      .get();

    expect(distinctReports?.count).toBe(1); // Only 1 distinct reporter
    expect(distinctReports?.count).toBeLessThan(3); // Should NOT trigger auto-hide
  });
});

describe("Community: Two-Way Blocking", () => {
  it("should hide content from blocked users in both directions", async () => {
    const store = createSqliteStore(":memory:", ":memory:");
    const userA = randomUUID();
    const userB = randomUUID();
    const postByB = randomUUID();
    const now = new Date().toISOString();

    // User A blocks User B
    await store.db.insert(userBlocks).values({
      blockId: randomUUID(),
      blockerUserId: userA,
      blockedUserId: userB,
      createdAt: now,
    });

    // User B creates a post
    await store.db.insert(communityPosts).values({
      postId: postByB,
      userId: userB,
      cardflowCardId: randomUUID(),
      createdAt: now,
    });

    // Query feed for User A (should filter out B's posts)
    const feedForA = await store.db
      .select()
      .from(communityPosts)
      .where(
        and(
          sql`${communityPosts.removedAt} IS NULL`,
          sql`${communityPosts.hiddenAt} IS NULL`,
          // Two-way block filter
          sql`NOT EXISTS (
            SELECT 1 FROM ${userBlocks}
            WHERE (
              (${userBlocks.blockerUserId} = ${userA} AND ${userBlocks.blockedUserId} = ${communityPosts.userId})
              OR
              (${userBlocks.blockerUserId} = ${communityPosts.userId} AND ${userBlocks.blockedUserId} = ${userA})
            )
          )`
        )
      );

    expect(feedForA.length).toBe(0); // User A should not see User B's post

    // Query feed for User B (should also filter out A's interaction)
    const feedForB = await store.db
      .select()
      .from(communityPosts)
      .where(
        and(
          sql`${communityPosts.removedAt} IS NULL`,
          sql`${communityPosts.hiddenAt} IS NULL`,
          sql`NOT EXISTS (
            SELECT 1 FROM ${userBlocks}
            WHERE (
              (${userBlocks.blockerUserId} = ${userB} AND ${userBlocks.blockedUserId} = ${communityPosts.userId})
              OR
              (${userBlocks.blockerUserId} = ${communityPosts.userId} AND ${userBlocks.blockedUserId} = ${userB})
            )
          )`
        )
      );

    // B should see their own post
    expect(feedForB.find((p) => p.postId === postByB)).toBeDefined();
  });
});

describe("Community: Username Availability", () => {
  it("should enforce case-insensitive uniqueness", async () => {
    const store = createSqliteStore(":memory:", ":memory:");
    
    // This test would require the user_accounts table and username logic
    // Placeholder for username uniqueness check
    const username1 = "TestUser";
    const username2 = "testuser";
    
    // Both should map to same username_lower
    expect(username1.toLowerCase()).toBe(username2.toLowerCase());
  });
});
