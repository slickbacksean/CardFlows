/**
 * Sean (Oct 25): Community tab endpoints - username, settings, posts, reactions, comments,
 * reports, blocks, and market data.
 */

import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { eq, and, sql, desc, isNull, isNotNull, lt, gte, inArray } from "drizzle-orm";
import type { SqliteStorePort } from "../sqlite-store";
import { validateUsername, validateCommentText, filterText } from "../text-filter";
import {
  userAccounts,
  reservedUsernames,
  communitySettings,
  communityPosts,
  postReactions,
  postComments,
  contentReports,
  userBlocks,
  commentRateLimits,
  cardPriceHistory,
  setTrendSnapshots,
  cardflowCards,
  crmInventoryItems,
} from "../db/schema";

const USERNAME_CHANGE_COOLDOWN_DAYS = 30;
const COMMENT_RATE_LIMIT = 10; // per hour
const AUTO_HIDE_REPORT_THRESHOLD = 3;
const MIN_BUYERS_FOR_AGGREGATE = 5;

/**
 * Check username availability (debounced client-side).
 * GET /v1/community/username/check?username=foo
 */
export async function checkUsernameAvailability(c: Context, store: SqliteStorePort): Promise<Response> {
  const username = c.req.query("username");
  if (!username) {
    return c.json({ available: false, reason: "Username required" }, 400);
  }

  const validation = validateUsername(username);
  if (!validation.allowed) {
    return c.json({ available: false, reason: validation.reason }, 200);
  }

  const usernameLower = username.toLowerCase();

  // Check reserved
  const reserved = await store.db
    .select()
    .from(reservedUsernames)
    .where(eq(reservedUsernames.usernameLower, usernameLower))
    .get();

  if (reserved) {
    return c.json({ available: false, reason: "Username is reserved" }, 200);
  }

  // Check taken
  const existing = await store.db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.usernameLower, usernameLower))
    .get();

  if (existing) {
    return c.json({ available: false, reason: "Username is taken" }, 200);
  }

  return c.json({ available: true }, 200);
}

/**
 * Set username (once at sign-up, or change with 30-day cooldown).
 * POST /v1/community/username { username: string }
 */
export async function setUsername(c: Context, userId: string, store: SqliteStorePort): Promise<Response> {
  const body = await c.req.json();
  const { username } = body;

  if (!username || typeof username !== "string") {
    return c.json({ error: "Username required" }, 400);
  }

  const validation = validateUsername(username);
  if (!validation.allowed) {
    return c.json({ error: validation.reason }, 400);
  }

  const usernameLower = username.toLowerCase();

  // Check reserved
  const reserved = await store.db
    .select()
    .from(reservedUsernames)
    .where(eq(reservedUsernames.usernameLower, usernameLower))
    .get();

  if (reserved) {
    return c.json({ error: "Username is reserved" }, 400);
  }

  // Get current user
  const user = await store.db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.userId, userId))
    .get();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  // Check 30-day cooldown if changing
  if (user.usernameChangedAt) {
    const changedAt = new Date(user.usernameChangedAt);
    const cooldownEnd = new Date(changedAt);
    cooldownEnd.setDate(cooldownEnd.getDate() + USERNAME_CHANGE_COOLDOWN_DAYS);

    if (new Date() < cooldownEnd) {
      const daysLeft = Math.ceil(
        (cooldownEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      return c.json(
        {
          error: `You can change your username again in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        },
        400
      );
    }
  }

  // Check if username is taken
  const existing = await store.db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.usernameLower, usernameLower))
    .get();

  if (existing && existing.userId !== userId) {
    return c.json({ error: "Username is taken" }, 400);
  }

  // Update username
  await store.db
    .update(userAccounts)
    .set({
      username: username.trim(),
      usernameLower,
      usernameChangedAt: new Date().toISOString(),
    })
    .where(eq(userAccounts.userId, userId))
    .run();

  return c.json({ username: username.trim() }, 200);
}

/**
 * Get current user's username.
 * GET /v1/community/username
 */
export async function getUsername(c: Context, userId: string, store: SqliteStorePort): Promise<Response> {
  const user = await store.db
    .select({ username: userAccounts.username, usernameChangedAt: userAccounts.usernameChangedAt })
    .from(userAccounts)
    .where(eq(userAccounts.userId, userId))
    .get();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({
    username: user.username,
    usernameChangedAt: user.usernameChangedAt,
  }, 200);
}

/**
 * Get or create community settings for user.
 * GET /v1/community/settings
 */
export async function getCommunitySettings(
  c: Context,
  userId: string,
  store: SqliteStorePort
): Promise<Response> {
  let settings = await store.db
    .select()
    .from(communitySettings)
    .where(eq(communitySettings.userId, userId))
    .get();

  if (!settings) {
    // Create default settings
    const now = new Date().toISOString();
    await store.db
      .insert(communitySettings)
      .values({
        userId,
        shareNew: false,
        showAs: "anonymous",
        sharePrice: false,
        rulesAccepted: false,
        updatedAt: now,
      })
      .run();

    settings = {
      userId,
      shareNew: false,
      showAs: "anonymous",
      sharePrice: false,
      rulesAccepted: false,
      rulesAcceptedAt: null,
      updatedAt: now,
    };
  }

  return c.json(settings, 200);
}

/**
 * Update community settings.
 * PATCH /v1/community/settings { shareNew?, showAs?, sharePrice?, rulesAccepted? }
 */
export async function updateCommunitySettings(
  c: Context,
  userId: string,
  store: SqliteStorePort
): Promise<Response> {
  const body = await c.req.json();
  const { shareNew, showAs, sharePrice, rulesAccepted } = body;

  const updates: any = { updatedAt: new Date().toISOString() };

  if (typeof shareNew === "boolean") {
    updates.shareNew = shareNew;

    // If turning off sharing, hide all user's posts
    if (!shareNew) {
      const now = new Date().toISOString();
      await store.db
        .update(communityPosts)
        .set({ hiddenAt: now })
        .where(and(eq(communityPosts.userId, userId), isNull(communityPosts.hiddenAt)))
        .run();
    }
  }

  if (showAs && (showAs === "anonymous" || showAs === "username")) {
    // Check user has username if choosing username
    if (showAs === "username") {
      const user = await store.db
        .select({ username: userAccounts.username })
        .from(userAccounts)
        .where(eq(userAccounts.userId, userId))
        .get();

      if (!user?.username) {
        return c.json({ error: "You must set a username first" }, 400);
      }
    }
    updates.showAs = showAs;
  }

  if (typeof sharePrice === "boolean") {
    updates.sharePrice = sharePrice;
  }

  if (typeof rulesAccepted === "boolean" && rulesAccepted) {
    updates.rulesAccepted = true;
    updates.rulesAcceptedAt = new Date().toISOString();
  }

  // Upsert settings
  await store.db
    .insert(communitySettings)
    .values({ userId, ...updates })
    .onConflictDoUpdate({
      target: communitySettings.userId,
      set: updates,
    })
    .run();

  return c.json({ updated: true }, 200);
}

/**
 * Get community feed with pagination.
 * GET /v1/community/feed?filter=all|sets&cursor=<postId>&limit=20
 */
export async function getFeed(c: Context, userId: string, store: SqliteStorePort): Promise<Response> {
  const filter = c.req.query("filter") || "all";
  const cursor = c.req.query("cursor");
  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 50);

  // Get user's blocks
  const blocks = await store.db
    .select({ blockedUserId: userBlocks.blockedUserId })
    .from(userBlocks)
    .where(eq(userBlocks.blockerUserId, userId))
    .all();

  const blockedUserIds = new Set(blocks.map((b) => b.blockedUserId));

  // Get users who blocked this user
  const blockers = await store.db
    .select({ blockerUserId: userBlocks.blockerUserId })
    .from(userBlocks)
    .where(eq(userBlocks.blockedUserId, userId))
    .all();

  const blockerUserIds = new Set(blockers.map((b) => b.blockerUserId));

  // Build query
  // Build where conditions
  const whereConditions = [
    isNull(communityPosts.hiddenAt),
    isNull(communityPosts.removedAt)
  ];

  if (cursor) {
    const cursorPost = await store.db
      .select({ createdAt: communityPosts.createdAt })
      .from(communityPosts)
      .where(eq(communityPosts.postId, cursor))
      .get();

    if (cursorPost) {
      whereConditions.push(lt(communityPosts.createdAt, cursorPost.createdAt));
    }
  }

  let posts = await store.db
    .select({
      postId: communityPosts.postId,
      userId: communityPosts.userId,
      cardflowCardId: communityPosts.cardflowCardId,
      inventoryItemId: communityPosts.inventoryItemId,
      pricePaidCents: communityPosts.pricePaidCents,
      showAs: communityPosts.showAs,
      createdAt: communityPosts.createdAt,
      hiddenAt: communityPosts.hiddenAt,
      removedAt: communityPosts.removedAt,
      cardName: cardflowCards.name,
      cardSetName: cardflowCards.setName,
      cardLocalId: cardflowCards.localId,
      cardImageUrl: cardflowCards.imageBaseUrl,
      username: userAccounts.username,
    })
    .from(communityPosts)
    .innerJoin(cardflowCards, eq(communityPosts.cardflowCardId, cardflowCards.cardflowCardId))
    .leftJoin(userAccounts, eq(communityPosts.userId, userAccounts.userId))
    .where(and(...whereConditions))
    .orderBy(desc(communityPosts.createdAt))
    .limit(limit + 1)
    .all();

  // Filter out blocked users
  posts = posts.filter(
    (p) => !blockedUserIds.has(p.userId) && !blockerUserIds.has(p.userId)
  );

  const hasMore = posts.length > limit;
  if (hasMore) posts = posts.slice(0, limit);

  // Get reaction counts and user's reactions
  const postIds = posts.map((p) => p.postId);
  
  if (postIds.length === 0) {
    return c.json({
      posts: [],
      hasMore: false,
      nextCursor: null,
    });
  }

  const reactions = await store.db
    .select({
      postId: postReactions.postId,
      emoji: postReactions.emoji,
      count: sql<number>`count(*)`,
    })
    .from(postReactions)
    .where(inArray(postReactions.postId, postIds))
    .groupBy(postReactions.postId, postReactions.emoji)
    .all();

  const myReactions = await store.db
    .select({ postId: postReactions.postId, emoji: postReactions.emoji })
    .from(postReactions)
    .where(
      and(
        eq(postReactions.userId, userId),
        inArray(postReactions.postId, postIds)
      )
    )
    .all();

  const myReactionMap = new Map(myReactions.map((r) => [r.postId, r.emoji]));

  // Get comment counts
  const commentCounts = await store.db
    .select({
      postId: postComments.postId,
      count: sql<number>`count(*)`,
    })
    .from(postComments)
    .where(
      and(
        inArray(postComments.postId, postIds),
        isNull(postComments.removedAt)
      )
    )
    .groupBy(postComments.postId)
    .all();

  const commentCountMap = new Map(commentCounts.map((c) => [c.postId, c.count]));

  // Format response
  const formatted = posts.map((p) => {
    const postReactions = reactions.filter((r) => r.postId === p.postId);
    const reactionCounts = {
      fire: postReactions.find((r) => r.emoji === "fire")?.count || 0,
      eyes: postReactions.find((r) => r.emoji === "eyes")?.count || 0,
      gem: postReactions.find((r) => r.emoji === "gem")?.count || 0,
      open_mouth: postReactions.find((r) => r.emoji === "open_mouth")?.count || 0,
      clap: postReactions.find((r) => r.emoji === "clap")?.count || 0,
    };

    const displayName =
      p.showAs === "username" && p.username ? `@${p.username}` : "Anonymous collector";

    return {
      postId: p.postId,
      displayName,
      createdAt: p.createdAt,
      card: {
        name: p.cardName,
        setName: p.cardSetName,
        localId: p.cardLocalId,
        imageUrl: p.cardImageUrl,
      },
      pricePaidCents: p.pricePaidCents,
      reactionCounts,
      myReaction: myReactionMap.get(p.postId) || null,
      commentCount: commentCountMap.get(p.postId) || 0,
    };
  });

  const lastPost = posts[posts.length - 1];
  return c.json(
    {
      posts: formatted,
      nextCursor: hasMore && lastPost ? lastPost.postId : null,
    },
    200
  );
}

/**
 * React to a post (toggle).
 * PUT /v1/community/posts/:postId/reaction { emoji: string }
 */
export async function reactToPost(
  c: Context,
  userId: string,
  store: SqliteStorePort
): Promise<Response> {
  const postId = c.req.param("postId");
  if (!postId) {
    return c.json({ error: "Post ID required" }, 400);
  }

  const body = await c.req.json();
  const { emoji } = body;

  const validEmojis = ["fire", "eyes", "gem", "open_mouth", "clap"];
  if (!validEmojis.includes(emoji)) {
    return c.json({ error: "Invalid emoji" }, 400);
  }

  // Check post exists and not removed
  const post = await store.db
    .select()
    .from(communityPosts)
    .where(eq(communityPosts.postId, postId))
    .get();

  if (!post || post.removedAt) {
    return c.json({ error: "Post not found" }, 404);
  }

  // Check if user already reacted
  const existing = await store.db
    .select()
    .from(postReactions)
    .where(and(eq(postReactions.userId, userId), eq(postReactions.postId, postId)))
    .get();

  if (existing) {
    if (existing.emoji === emoji) {
      // Remove reaction (toggle off)
      await store.db
        .delete(postReactions)
        .where(and(eq(postReactions.userId, userId), eq(postReactions.postId, postId)))
        .run();
      return c.json({ reacted: false }, 200);
    } else {
      // Update reaction
      await store.db
        .update(postReactions)
        .set({ emoji, createdAt: new Date().toISOString() })
        .where(and(eq(postReactions.userId, userId), eq(postReactions.postId, postId)))
        .run();
      return c.json({ reacted: true, emoji }, 200);
    }
  }

  // Add reaction
  await store.db
    .insert(postReactions)
    .values({
      userId,
      postId,
      emoji,
      createdAt: new Date().toISOString(),
    })
    .run();

  return c.json({ reacted: true, emoji }, 200);
}

/**
 * Delete reaction from a post.
 * DELETE /v1/community/posts/:postId/reaction
 */
export async function deleteReaction(
  c: Context,
  userId: string,
  store: SqliteStorePort
): Promise<Response> {
  const postId = c.req.param("postId");
  if (!postId) {
    return c.json({ error: "Post ID required" }, 400);
  }

  await store.db
    .delete(postReactions)
    .where(and(eq(postReactions.userId, userId), eq(postReactions.postId, postId)))
    .run();

  return c.json({ deleted: true }, 200);
}

/**
 * Get comments for a post.
 * GET /v1/community/posts/:postId/comments?cursor=<commentId>&limit=50
 */
export async function getComments(
  c: Context,
  userId: string,
  store: SqliteStorePort
): Promise<Response> {
  const postId = c.req.param("postId");
  if (!postId) {
    return c.json({ error: "Post ID required" }, 400);
  }

  const cursor = c.req.query("cursor");
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);

  // Get user's blocks
  const blocks = await store.db
    .select({ blockedUserId: userBlocks.blockedUserId })
    .from(userBlocks)
    .where(eq(userBlocks.blockerUserId, userId))
    .all();

  const blockedUserIds = new Set(blocks.map((b) => b.blockedUserId));

  // Build where conditions
  const whereConditions = [eq(postComments.postId, postId)];

  if (cursor) {
    const cursorComment = await store.db
      .select({ createdAt: postComments.createdAt })
      .from(postComments)
      .where(eq(postComments.commentId, cursor))
      .get();

    if (cursorComment) {
      whereConditions.push(sql`${postComments.createdAt} > ${cursorComment.createdAt}`);
    }
  }

  // Get comments
  let comments = await store.db
    .select({
      commentId: postComments.commentId,
      userId: postComments.userId,
      text: postComments.text,
      createdAt: postComments.createdAt,
      hiddenAt: postComments.hiddenAt,
      removedAt: postComments.removedAt,
      username: userAccounts.username,
    })
    .from(postComments)
    .leftJoin(userAccounts, eq(postComments.userId, userAccounts.userId))
    .where(and(...whereConditions))
    .orderBy(postComments.createdAt)
    .limit(limit + 1)
    .all();

  // Filter blocked users
  comments = comments.filter((c) => !blockedUserIds.has(c.userId));

  const hasMore = comments.length > limit;
  if (hasMore) comments = comments.slice(0, limit);

  const formatted = comments.map((c) => ({
    commentId: c.commentId,
    userId: c.userId,
    username: c.username ? `@${c.username}` : "Anonymous",
    text: c.removedAt ? "Comment removed." : c.text,
    createdAt: c.createdAt,
    isOwn: c.userId === userId,
    removed: !!c.removedAt,
    hidden: !!c.hiddenAt && !c.removedAt,
  }));

  const lastComment = comments[comments.length - 1];
  return c.json(
    {
      comments: formatted,
      nextCursor: hasMore && lastComment ? lastComment.commentId : null,
    },
    200
  );
}

/**
 * Post a comment.
 * POST /v1/community/posts/:postId/comments { text: string }
 */
export async function postComment(
  c: Context,
  userId: string,
  store: SqliteStorePort
): Promise<Response> {
  const postId = c.req.param("postId");
  if (!postId) {
    return c.json({ error: "Post ID required" }, 400);
  }

  const body = await c.req.json();
  const { text } = body;

  if (!text || typeof text !== "string") {
    return c.json({ error: "Comment text required" }, 400);
  }

  const validation = validateCommentText(text);
  if (!validation.allowed) {
    return c.json({ error: validation.reason }, 400);
  }

  // Check post exists
  const post = await store.db
    .select()
    .from(communityPosts)
    .where(eq(communityPosts.postId, postId))
    .get();

  if (!post || post.removedAt) {
    return c.json({ error: "Post not found" }, 404);
  }

  // Check rules accepted
  const settings = await store.db
    .select({ rulesAccepted: communitySettings.rulesAccepted })
    .from(communitySettings)
    .where(eq(communitySettings.userId, userId))
    .get();

  if (!settings?.rulesAccepted) {
    return c.json({ error: "You must accept community rules first" }, 400);
  }

  // Rate limit: 10 per hour
  const now = new Date();
  const hourKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}-${String(now.getUTCHours()).padStart(2, "0")}`;

  const rateLimit = await store.db
    .select()
    .from(commentRateLimits)
    .where(and(eq(commentRateLimits.userId, userId), eq(commentRateLimits.hourKey, hourKey)))
    .get();

  if (rateLimit && rateLimit.count >= COMMENT_RATE_LIMIT) {
    return c.json(
      { error: "Rate limit exceeded. You can post 10 comments per hour." },
      429
    );
  }

  // Create comment
  const commentId = `cmt_${randomUUID()}`;
  await store.db
    .insert(postComments)
    .values({
      commentId,
      postId,
      userId,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    })
    .run();

  // Update rate limit
  await store.db
    .insert(commentRateLimits)
    .values({ userId, hourKey, count: 1 })
    .onConflictDoUpdate({
      target: [commentRateLimits.userId, commentRateLimits.hourKey],
      set: { count: sql`${commentRateLimits.count} + 1` },
    })
    .run();

  return c.json({ commentId }, 201);
}

/**
 * Delete own comment.
 * DELETE /v1/community/comments/:commentId
 */
export async function deleteComment(
  c: Context,
  userId: string,
  store: SqliteStorePort
): Promise<Response> {
  const commentId = c.req.param("commentId");
  if (!commentId) {
    return c.json({ error: "Comment ID required" }, 400);
  }

  const comment = await store.db
    .select()
    .from(postComments)
    .where(eq(postComments.commentId, commentId))
    .get();

  if (!comment) {
    return c.json({ error: "Comment not found" }, 404);
  }

  if (comment.userId !== userId) {
    return c.json({ error: "Not your comment" }, 403);
  }

  await store.db
    .update(postComments)
    .set({ removedAt: new Date().toISOString() })
    .where(eq(postComments.commentId, commentId))
    .run();

  return c.json({ deleted: true }, 200);
}

/**
 * Report content (post, comment, username).
 * POST /v1/community/reports { targetType, targetId, reason, note? }
 */
export async function reportContent(
  c: Context,
  userId: string,
  store: SqliteStorePort
): Promise<Response> {
  const body = await c.req.json();
  const { targetType, targetId, reason, note } = body;

  const validTypes = ["post", "comment", "username"];
  const validReasons = ["spam", "harassment", "offensive", "scam", "other"];

  if (!validTypes.includes(targetType) || !validReasons.includes(reason)) {
    return c.json({ error: "Invalid report" }, 400);
  }

  const reportId = `rep_${randomUUID()}`;
  await store.db
    .insert(contentReports)
    .values({
      reportId,
      reporterUserId: userId,
      targetType,
      targetId,
      reason,
      note: note || null,
      createdAt: new Date().toISOString(),
    })
    .run();

  // Auto-hide after 3 reports from different users
  const reportCount = await store.db
    .select({ count: sql<number>`count(DISTINCT ${contentReports.reporterUserId})` })
    .from(contentReports)
    .where(
      and(
        eq(contentReports.targetType, targetType),
        eq(contentReports.targetId, targetId),
        isNull(contentReports.resolvedAt)
      )
    )
    .get();

  if (reportCount && reportCount.count >= AUTO_HIDE_REPORT_THRESHOLD) {
    if (targetType === "post") {
      await store.db
        .update(communityPosts)
        .set({ hiddenAt: new Date().toISOString() })
        .where(eq(communityPosts.postId, targetId))
        .run();
    } else if (targetType === "comment") {
      await store.db
        .update(postComments)
        .set({ hiddenAt: new Date().toISOString() })
        .where(eq(postComments.commentId, targetId))
        .run();
    }
  }

  return c.json(
    { message: "Thanks. We'll review this within 24 hours.", reported: true },
    200
  );
}

/**
 * Block a user.
 * POST /v1/community/blocks/:userId
 */
export async function blockUser(
  c: Context,
  userId: string,
  store: SqliteStorePort
): Promise<Response> {
  const blockedUserId = c.req.param("userId");
  if (!blockedUserId) {
    return c.json({ error: "User ID required" }, 400);
  }

  if (blockedUserId === userId) {
    return c.json({ error: "Cannot block yourself" }, 400);
  }

  await store.db
    .insert(userBlocks)
    .values({
      blockerUserId: userId,
      blockedUserId,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();

  return c.json({ blocked: true }, 200);
}

/**
 * Unblock a user.
 * DELETE /v1/community/blocks/:userId
 */
export async function unblockUser(
  c: Context,
  userId: string,
  store: SqliteStorePort
): Promise<Response> {
  const blockedUserId = c.req.param("userId");
  if (!blockedUserId) {
    return c.json({ error: "User ID required" }, 400);
  }

  await store.db
    .delete(userBlocks)
    .where(
      and(eq(userBlocks.blockerUserId, userId), eq(userBlocks.blockedUserId, blockedUserId))
    )
    .run();

  return c.json({ unblocked: true }, 200);
}

/**
 * Get blocked users list.
 * GET /v1/community/blocks
 */
export async function getBlockedUsers(
  c: Context,
  userId: string,
  store: SqliteStorePort
): Promise<Response> {
  const blocks = await store.db
    .select({
      userId: userBlocks.blockedUserId,
      username: userAccounts.username,
      blockedAt: userBlocks.createdAt,
    })
    .from(userBlocks)
    .leftJoin(userAccounts, eq(userBlocks.blockedUserId, userAccounts.userId))
    .where(eq(userBlocks.blockerUserId, userId))
    .all();

  return c.json({ blocks }, 200);
}

/**
 * Market movers (rising/falling cards).
 * GET /v1/community/market/movers?window=24h|7d|30d&direction=up|down&limit=10
 */
export async function getMarketMovers(c: Context, store: SqliteStorePort): Promise<Response> {
  const window = c.req.query("window") || "7d";
  const direction = c.req.query("direction") || "up";
  const limit = Math.min(parseInt(c.req.query("limit") || "10", 10), 50);

  // For now, return empty state until price history is populated
  return c.json({
    movers: [],
    window,
    updatedAt: new Date().toISOString(),
    message: "Price history data not yet available",
  }, 200);
}

/**
 * What's buying aggregate (min 5 distinct users).
 * GET /v1/community/market/buying?window=24h|7d|30d&limit=10
 */
export async function getWhatsBuying(c: Context, store: SqliteStorePort): Promise<Response> {
  const window = c.req.query("window") || "7d";
  const limit = Math.min(parseInt(c.req.query("limit") || "10", 10), 50);

  // Calculate window start
  const now = new Date();
  const windowStart = new Date(now);
  if (window === "24h") {
    windowStart.setHours(windowStart.getHours() - 24);
  } else if (window === "7d") {
    windowStart.setDate(windowStart.getDate() - 7);
  } else if (window === "30d") {
    windowStart.setDate(windowStart.getDate() - 30);
  }

  // Get purchase aggregates
  const purchases = await store.db
    .select({
      cardflowCardId: crmInventoryItems.cardflowCardId,
      distinctBuyers: sql<number>`count(DISTINCT ${crmInventoryItems.userId})`,
      cardName: cardflowCards.name,
      cardSetName: cardflowCards.setName,
      cardLocalId: cardflowCards.localId,
      cardImageUrl: cardflowCards.imageBaseUrl,
    })
    .from(crmInventoryItems)
    .innerJoin(cardflowCards, eq(crmInventoryItems.cardflowCardId, cardflowCards.cardflowCardId))
    .where(
      and(
        eq(crmInventoryItems.intent, "purchased"),
        sql`${crmInventoryItems.createdAt} >= ${windowStart.toISOString()}`
      )
    )
    .groupBy(crmInventoryItems.cardflowCardId)
    .having(sql`count(DISTINCT ${crmInventoryItems.userId}) >= ${MIN_BUYERS_FOR_AGGREGATE}`)
    .orderBy(sql`count(DISTINCT ${crmInventoryItems.userId}) DESC`)
    .limit(limit)
    .all();

  const formatted = purchases.map((p) => ({
    card: {
      cardflowCardId: p.cardflowCardId,
      name: p.cardName,
      setName: p.cardSetName,
      localId: p.cardLocalId,
      imageUrl: p.cardImageUrl,
    },
    distinctBuyers: p.distinctBuyers,
    window,
  }));

  return c.json({
    buying: formatted,
    updatedAt: new Date().toISOString(),
  }, 200);
}

/**
 * What's selling (public sales data).
 * GET /v1/community/market/selling?window=24h|7d|30d&limit=10
 */
export async function getWhatsSelling(c: Context, store: SqliteStorePort): Promise<Response> {
  const window = c.req.query("window") || "7d";
  const limit = Math.min(parseInt(c.req.query("limit") || "10", 10), 50);

  // Return empty until real sales data is wired
  return c.json({
    selling: [],
    window,
    updatedAt: new Date().toISOString(),
    message: "Public sales data not yet available",
  }, 200);
}

/**
 * Set trends.
 * GET /v1/community/market/sets?window=7d&limit=20
 */
export async function getSetTrends(c: Context, store: SqliteStorePort): Promise<Response> {
  const window = c.req.query("window") || "7d";
  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 50);

  // Return empty until trend data is computed
  return c.json({
    sets: [],
    window,
    updatedAt: new Date().toISOString(),
    message: "Set trend data not yet available",
  }, 200);
}

/**
 * Admin: list pending moderation reports.
 * GET /v1/community/admin/reports?limit=50&offset=0
 */
export async function listReports(c: Context, store: SqliteStorePort): Promise<Response> {
  // TODO: Check admin role
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const reports = await store.db
    .select({
      reportId: contentReports.reportId,
      targetType: contentReports.targetType,
      targetId: contentReports.targetId,
      reason: contentReports.reason,
      note: contentReports.note,
      reporterUserId: contentReports.reporterUserId,
      createdAt: contentReports.createdAt,
      resolvedAt: contentReports.resolvedAt,
      resolution: contentReports.resolution,
    })
    .from(contentReports)
    .where(isNull(contentReports.resolvedAt))
    .orderBy(desc(contentReports.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ reports });
}

/**
 * Admin: resolve a moderation report with action.
 * POST /v1/community/admin/reports/:reportId/resolve
 * Body: { action: "remove" | "warn" | "suspend" | "ban" | "dismiss", notifyUser?: boolean }
 */
export async function resolveReport(c: Context, store: SqliteStorePort): Promise<Response> {
  // TODO: Check admin role
  const reportId = c.req.param("reportId");
  if (!reportId) {
    return c.json({ error: "Report ID required" }, 400);
  }

  const { action, notifyUser } = await c.req.json();
  const adminUserId = c.get("userId");

  if (!["remove", "warn", "suspend", "ban", "dismiss"].includes(action)) {
    return c.json({ error: "Invalid action" }, 400);
  }

  // Resolve the report
  await store.db
    .update(contentReports)
    .set({
      resolvedAt: new Date().toISOString(),
      resolution: action,
    })
    .where(eq(contentReports.reportId, reportId));

  // Get the report to find target
  const report = await store.db
    .select()
    .from(contentReports)
    .where(eq(contentReports.reportId, reportId))
    .get();

  if (!report) {
    return c.json({ error: "Report not found" }, 404);
  }

  // Apply action
  if (action === "remove") {
    if (report.targetType === "post") {
      await store.db
        .update(communityPosts)
        .set({ removedAt: new Date().toISOString() })
        .where(eq(communityPosts.postId, report.targetId));
    } else if (report.targetType === "comment") {
      await store.db
        .update(postComments)
        .set({ removedAt: new Date().toISOString() })
        .where(eq(postComments.commentId, report.targetId));
    }
  }

  // TODO: If notifyUser, send in-app notice to author

  return c.json({ success: true });
}

/**
 * Get moderation notices for current user.
 * GET /v1/community/moderation/notices
 */
export async function getModerationNotices(c: Context, store: SqliteStorePort): Promise<Response> {
  const userId = c.get("userId");
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [removedPosts, removedComments] = await Promise.all([
    store.db
      .select({
        type: sql<string>`'post'`,
        id: communityPosts.postId,
        createdAt: communityPosts.createdAt,
        removedAt: communityPosts.removedAt,
      })
      .from(communityPosts)
      .where(
        and(
          eq(communityPosts.userId, userId),
          sql`${communityPosts.removedAt} IS NOT NULL`,
          sql`${communityPosts.removedAt} >= ${thirtyDaysAgo}`
        )
      ),
    store.db
      .select({
        type: sql<string>`'comment'`,
        id: postComments.commentId,
        createdAt: postComments.createdAt,
        removedAt: postComments.removedAt,
      })
      .from(postComments)
      .where(
        and(
          eq(postComments.userId, userId),
          sql`${postComments.removedAt} IS NOT NULL`,
          sql`${postComments.removedAt} >= ${thirtyDaysAgo}`
        )
      ),
  ]);

  const notices = [...removedPosts, ...removedComments].sort(
    (a, b) => new Date(b.removedAt!).getTime() - new Date(a.removedAt!).getTime()
  );

  return c.json({ notices });
}
