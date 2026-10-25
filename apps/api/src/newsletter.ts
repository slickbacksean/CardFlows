/**
 * Sean (Oct 25): Newsletter service - content generation, subscriptions, and sending.
 */

import { randomUUID, createHmac } from "node:crypto";
import { eq, and, sql, desc, isNull, gte, isNotNull, inArray } from "drizzle-orm";
import type { SqliteStorePort } from "./sqlite-store";
import {
  newsletterSubscriptions,
  newsletterIssues,
  newsletterSendLog,
  communityPosts,
  cardflowCards,
  userAccounts,
  crmInventoryItems,
  postReactions,
} from "./db/schema";
import type { EmailProviderPort, EmailMessage } from "./email-provider";

const NEWSLETTER_SECRET = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET || "dev-secret-change-in-prod";
const MIN_BUYERS_FOR_SAVINGS = 5;

export interface NewsletterContent {
  weekStart: string;
  weekEnd: string;
  movers: {
    rising: Array<{
      cardName: string;
      setName: string;
      imageUrl: string;
      changePercent: number;
      currentPrice: number;
    }>;
    falling: Array<{
      cardName: string;
      setName: string;
      imageUrl: string;
      changePercent: number;
      currentPrice: number;
    }>;
  };
  estimatedSavings: {
    totalCents: number;
    distinctBuyers: number;
    available: boolean;
  };
  trendingSets: Array<{
    setName: string;
    changePercent: number;
  }>;
  featuredPosts: Array<{
    postId: string;
    displayName: string;
    cardName: string;
    cardSetName: string;
    cardImageUrl: string;
    reactionCount: number;
    createdAt: string;
  }>;
}

export function generateUnsubscribeToken(userId: string): string {
  const hmac = createHmac("sha256", NEWSLETTER_SECRET);
  hmac.update(`${userId}:newsletter:v1`);
  return `${userId}.${hmac.digest("base64url")}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const [userId, signature] = token.split(".");
  if (!userId || !signature) return null;

  const expectedToken = generateUnsubscribeToken(userId);
  if (token !== expectedToken) return null;

  return userId;
}

export async function subscribeUser(
  userId: string,
  email: string,
  store: SqliteStorePort,
): Promise<{ success: boolean; error?: string }> {
  const now = new Date().toISOString();
  const unsubscribeToken = generateUnsubscribeToken(userId);

  try {
    await store.db
      .insert(newsletterSubscriptions)
      .values({
        userId,
        email,
        subscribedAt: now,
        unsubscribeToken,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: newsletterSubscriptions.userId,
        set: {
          email,
          subscribedAt: now,
          unsubscribedAt: null,
          updatedAt: now,
        },
      })
      .run();

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function unsubscribeUser(
  userId: string,
  store: SqliteStorePort,
): Promise<{ success: boolean }> {
  const now = new Date().toISOString();

  await store.db
    .update(newsletterSubscriptions)
    .set({
      unsubscribedAt: now,
      updatedAt: now,
    })
    .where(eq(newsletterSubscriptions.userId, userId))
    .run();

  return { success: true };
}

export async function getSubscriptionStatus(
  userId: string,
  store: SqliteStorePort,
): Promise<{ subscribed: boolean; subscribedAt?: string }> {
  const sub = await store.db
    .select()
    .from(newsletterSubscriptions)
    .where(eq(newsletterSubscriptions.userId, userId))
    .get();

  if (!sub || sub.unsubscribedAt) {
    return { subscribed: false };
  }

  return { subscribed: true, subscribedAt: sub.subscribedAt };
}

export async function generateNewsletterContent(
  weekStart: Date,
  weekEnd: Date,
  store: SqliteStorePort,
): Promise<NewsletterContent> {
  const weekStartStr = weekStart.toISOString();
  const weekEndStr = weekEnd.toISOString();

  // Fetch market movers (empty for now - placeholder for when price history is populated)
  const movers = { rising: [], falling: [] };

  // Calculate estimated savings
  const savingsData = await store.db
    .select({
      totalSavings: sql<number>`SUM(CASE 
        WHEN ${sql`crm_purchases.purchase_price`} IS NOT NULL 
          AND ${sql`crm_purchases.reference_price_amount`} IS NOT NULL 
          AND ${sql`crm_purchases.reference_price_amount`} > ${sql`crm_purchases.purchase_price`}
        THEN ${sql`crm_purchases.reference_price_amount - crm_purchases.purchase_price`}
        ELSE 0
      END)`,
      distinctBuyers: sql<number>`COUNT(DISTINCT ${sql`crm_inventory_items.user_id`})`,
    })
    .from(sql`crm_inventory_items`)
    .innerJoin(sql`crm_purchases`, sql`crm_inventory_items.inventory_item_id = crm_purchases.inventory_item_id`)
    .where(
      sql`crm_inventory_items.intent = 'purchased' AND crm_inventory_items.created_at >= ${weekStartStr} AND crm_inventory_items.created_at < ${weekEndStr}`,
    )
    .get();

  const hasSufficientData =
    savingsData && savingsData.distinctBuyers >= MIN_BUYERS_FOR_SAVINGS;

  const estimatedSavings = {
    totalCents: hasSufficientData ? (savingsData?.totalSavings || 0) : 0,
    distinctBuyers: savingsData?.distinctBuyers || 0,
    available: !!hasSufficientData,
  };

  // Trending sets (empty for now - placeholder)
  const trendingSets: NewsletterContent["trendingSets"] = [];

  // Featured community posts (up to 3, public, not hidden/removed, sorted by reactions)
  const posts = await store.db
    .select({
      postId: communityPosts.postId,
      userId: communityPosts.userId,
      showAs: communityPosts.showAs,
      cardName: cardflowCards.name,
      cardSetName: cardflowCards.setName,
      cardImageUrl: cardflowCards.imageBaseUrl,
      username: userAccounts.username,
      createdAt: communityPosts.createdAt,
    })
    .from(communityPosts)
    .innerJoin(cardflowCards, eq(communityPosts.cardflowCardId, cardflowCards.cardflowCardId))
    .leftJoin(userAccounts, eq(communityPosts.userId, userAccounts.userId))
    .where(
      and(
        isNull(communityPosts.hiddenAt),
        isNull(communityPosts.removedAt),
        gte(communityPosts.createdAt, weekStartStr),
        sql`${communityPosts.createdAt} < ${weekEndStr}`,
      ),
    )
    .orderBy(desc(communityPosts.createdAt))
    .limit(50)
    .all();

  // Get reaction counts for these posts
  const postIds = posts.map((p) => p.postId);
  let reactionCounts: Array<{ postId: string; count: number }> = [];

  if (postIds.length > 0) {
    reactionCounts = await store.db
      .select({
        postId: postReactions.postId,
        count: sql<number>`count(*)`.as("count"),
      })
      .from(postReactions)
      .where(inArray(postReactions.postId, postIds))
      .groupBy(postReactions.postId)
      .all();
  }

  const reactionMap = new Map(reactionCounts.map((r) => [r.postId, r.count]));

  const postsWithReactions = posts
    .map((p) => ({
      postId: p.postId,
      displayName: p.showAs === "username" && p.username ? `@${p.username}` : "Anonymous collector",
      cardName: p.cardName,
      cardSetName: p.cardSetName,
      cardImageUrl: p.cardImageUrl || "",
      reactionCount: reactionMap.get(p.postId) || 0,
      createdAt: p.createdAt,
    }))
    .sort((a, b) => b.reactionCount - a.reactionCount)
    .slice(0, 3);

  return {
    weekStart: weekStartStr,
    weekEnd: weekEndStr,
    movers,
    estimatedSavings,
    trendingSets,
    featuredPosts: postsWithReactions,
  };
}

export async function createDraftIssue(
  content: NewsletterContent,
  store: SqliteStorePort,
): Promise<string> {
  const issueId = `issue_${randomUUID()}`;
  const now = new Date().toISOString();

  await store.db
    .insert(newsletterIssues)
    .values({
      issueId,
      weekStart: content.weekStart,
      weekEnd: content.weekEnd,
      status: "draft",
      contentSnapshot: JSON.stringify(content),
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return issueId;
}

export async function approveIssue(
  issueId: string,
  adminUserId: string,
  store: SqliteStorePort,
): Promise<{ success: boolean; error?: string }> {
  const issue = await store.db
    .select()
    .from(newsletterIssues)
    .where(eq(newsletterIssues.issueId, issueId))
    .get();

  if (!issue) {
    return { success: false, error: "Issue not found" };
  }

  if (issue.status !== "draft") {
    return { success: false, error: "Issue is not in draft status" };
  }

  const now = new Date().toISOString();
  await store.db
    .update(newsletterIssues)
    .set({
      status: "approved",
      approvedAt: now,
      approvedBy: adminUserId,
      updatedAt: now,
    })
    .where(eq(newsletterIssues.issueId, issueId))
    .run();

  return { success: true };
}

export function renderNewsletterHtml(
  content: NewsletterContent,
  unsubscribeUrl: string,
  mailingAddress: string,
): string {
  const weekStartDate = new Date(content.weekStart).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const weekEndDate = new Date(content.weekEnd).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const savingsSection = content.estimatedSavings.available
    ? `
    <div style="margin: 20px 0; padding: 20px; background: #f8f9fa; border-radius: 8px;">
      <h2 style="margin: 0 0 10px 0; font-size: 20px; color: #333;">Community Savings</h2>
      <p style="margin: 0; font-size: 32px; font-weight: bold; color: #28a745;">
        $${(content.estimatedSavings.totalCents / 100).toFixed(2)}
      </p>
      <p style="margin: 5px 0 0 0; font-size: 14px; color: #6c757d;">
        Estimated total saved by ${content.estimatedSavings.distinctBuyers} collectors this week
      </p>
      <p style="margin: 10px 0 0 0; font-size: 12px; color: #6c757d; font-style: italic;">
        Based on market value minus purchase price for cards where collectors shared their purchase price. 
        This is an estimate only and not financial advice.
      </p>
    </div>
    `
    : '<p style="margin: 20px 0; font-size: 14px; color: #6c757d;">Community savings data not yet available.</p>';

  const moversSection =
    content.movers.rising.length > 0 || content.movers.falling.length > 0
      ? `
    <div style="margin: 30px 0;">
      <h2 style="margin: 0 0 15px 0; font-size: 22px; color: #333;">Market Movers</h2>
      ${content.movers.rising.length > 0 ? `<h3 style="font-size: 18px; color: #28a745;">📈 Rising</h3>` : ""}
      ${content.movers.rising.map((card) => `<p>${card.cardName} - ${card.setName}: +${card.changePercent.toFixed(1)}%</p>`).join("")}
      ${content.movers.falling.length > 0 ? `<h3 style="font-size: 18px; color: #dc3545;">📉 Falling</h3>` : ""}
      ${content.movers.falling.map((card) => `<p>${card.cardName} - ${card.setName}: ${card.changePercent.toFixed(1)}%</p>`).join("")}
    </div>
    `
      : '<p style="margin: 20px 0; font-size: 14px; color: #6c757d;">Market movers data not yet available.</p>';

  const postsSection =
    content.featuredPosts.length > 0
      ? `
    <div style="margin: 30px 0;">
      <h2 style="margin: 0 0 15px 0; font-size: 22px; color: #333;">Featured Community Posts</h2>
      ${content.featuredPosts
        .map(
          (post) => `
        <div style="margin: 15px 0; padding: 15px; border: 1px solid #dee2e6; border-radius: 8px;">
          <p style="margin: 0 0 5px 0; font-weight: bold; color: #007bff;">${post.displayName}</p>
          <p style="margin: 0 0 5px 0; font-size: 16px; color: #333;">${post.cardName} - ${post.cardSetName}</p>
          <p style="margin: 0; font-size: 14px; color: #6c757d;">${post.reactionCount} reactions</p>
        </div>
      `,
        )
        .join("")}
    </div>
    `
      : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PokeSniper Weekly - ${weekStartDate}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="margin: 0; font-size: 28px; color: #007bff;">PokeSniper Weekly</h1>
    <p style="margin: 5px 0 0 0; font-size: 14px; color: #6c757d;">${weekStartDate} - ${weekEndDate}</p>
  </div>

  ${savingsSection}
  ${moversSection}
  ${postsSection}

  <div style="margin: 40px 0 20px 0; padding: 20px; background: #f8f9fa; border-top: 2px solid #dee2e6; font-size: 12px; color: #6c757d;">
    <p style="margin: 0 0 10px 0;"><strong>Why am I receiving this?</strong></p>
    <p style="margin: 0 0 10px 0;">You opted in to receive the PokeSniper weekly newsletter.</p>
    
    <p style="margin: 15px 0 10px 0;"><strong>Unsubscribe</strong></p>
    <p style="margin: 0 0 10px 0;">
      <a href="${unsubscribeUrl}" style="color: #007bff; text-decoration: none;">Click here to unsubscribe</a>
    </p>

    <p style="margin: 15px 0 10px 0;"><strong>Mailing Address</strong></p>
    <p style="margin: 0;">${mailingAddress}</p>

    <p style="margin: 15px 0 0 0; font-style: italic;">
      Estimates are not financial advice. PokeSniper is not affiliated with The Pokémon Company or Nintendo.
    </p>
  </div>
</body>
</html>
  `.trim();
}

export async function sendIssue(
  issueId: string,
  store: SqliteStorePort,
  emailProvider: EmailProviderPort,
  baseUrl: string,
  fromAddress: string,
  mailingAddress: string,
): Promise<{ success: boolean; sent: number; failed: number; skipped: number; error?: string }> {
  const issue = await store.db
    .select()
    .from(newsletterIssues)
    .where(eq(newsletterIssues.issueId, issueId))
    .get();

  if (!issue) {
    return { success: false, sent: 0, failed: 0, skipped: 0, error: "Issue not found" };
  }

  if (issue.status !== "approved") {
    return { success: false, sent: 0, failed: 0, skipped: 0, error: "Issue not approved" };
  }

  // Get active subscriptions
  const subscribers = await store.db
    .select()
    .from(newsletterSubscriptions)
    .where(isNull(newsletterSubscriptions.unsubscribedAt))
    .all();

  if (subscribers.length === 0) {
    return { success: true, sent: 0, failed: 0, skipped: 0 };
  }

  const content = JSON.parse(issue.contentSnapshot as string) as NewsletterContent;
  const rateLimits = emailProvider.getRateLimits();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const subscriber of subscribers) {
    // Check if already sent
    const existing = await store.db
      .select()
      .from(newsletterSendLog)
      .where(
        and(
          eq(newsletterSendLog.issueId, issueId),
          eq(newsletterSendLog.userId, subscriber.userId),
        ),
      )
      .get();

    if (existing && existing.status === "sent") {
      skipped++;
      continue;
    }

    const sendId = existing?.sendId || `send_${randomUUID()}`;
    const unsubscribeUrl = `${baseUrl}/v1/newsletter/unsubscribe?token=${subscriber.unsubscribeToken}`;
    const html = renderNewsletterHtml(content, unsubscribeUrl, mailingAddress);

    const message: EmailMessage = {
      to: subscriber.email,
      from: fromAddress,
      subject: `PokeSniper Weekly - ${new Date(content.weekStart).toLocaleDateString("en-US", { month: "long", day: "numeric" })}`,
      html,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };

    const result = await emailProvider.send(message);
    const now = new Date().toISOString();

    if (result.success) {
      if (!existing) {
        await store.db
          .insert(newsletterSendLog)
          .values({
            sendId,
            issueId,
            userId: subscriber.userId,
            email: subscriber.email,
            status: "sent",
            providerMessageId: result.messageId || null,
            sentAt: now,
            updatedAt: now,
          })
          .run();
      } else {
        await store.db
          .update(newsletterSendLog)
          .set({
            status: "sent",
            providerMessageId: result.messageId || null,
            sentAt: now,
            updatedAt: now,
          })
          .where(eq(newsletterSendLog.sendId, sendId))
          .run();
      }
      sent++;
    } else {
      if (!existing) {
        await store.db
          .insert(newsletterSendLog)
          .values({
            sendId,
            issueId,
            userId: subscriber.userId,
            email: subscriber.email,
            status: "failed",
            updatedAt: now,
          })
          .run();
      }
      failed++;
      console.error(`[NEWSLETTER] Failed to send to ${subscriber.email}:`, result.error);
    }

    // Rate limiting: sleep between sends
    if (sent % rateLimits.maxPerSecond === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Mark issue as sent
  await store.db
    .update(newsletterIssues)
    .set({
      status: "sent",
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(newsletterIssues.issueId, issueId))
    .run();

  return { success: true, sent, failed, skipped };
}
