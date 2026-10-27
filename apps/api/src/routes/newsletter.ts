/**
 * Sean (Oct 25): Newsletter routes - subscriptions, admin preview/send, unsubscribe, webhooks.
 */

import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import type { SqliteStorePort } from "../sqlite-store";
import type { EmailProviderPort } from "../email-provider";
import {
  subscribeUser,
  unsubscribeUser,
  getSubscriptionStatus,
  generateNewsletterContent,
  createDraftIssue,
  approveIssue,
  sendIssue,
  verifyUnsubscribeToken,
  renderNewsletterHtml,
  generateUnsubscribeToken,
} from "../newsletter";
import { newsletterIssues, newsletterSendLog, newsletterSubscriptions } from "../db/schema";
import { isAdmin as checkAdminRole } from "../admin-auth";

/**
 * Check if user has admin role
 */
async function isAdmin(userId: string, store: SqliteStorePort): Promise<boolean> {
  return await checkAdminRole(userId, store);
}

/**
 * Subscribe to newsletter.
 * POST /v1/newsletter/subscribe { email: string }
 */
export async function subscribe(
  c: Context,
  userId: string,
  store: SqliteStorePort,
): Promise<Response> {
  const body = await c.req.json();
  const { email } = body;

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return c.json({ error: "Valid email required" }, 400);
  }

  const result = await subscribeUser(userId, email, store);

  if (!result.success) {
    return c.json({ error: result.error }, 500);
  }

  return c.json({ subscribed: true }, 200);
}

/**
 * Unsubscribe from newsletter.
 * POST /v1/newsletter/unsubscribe
 * Query param: ?token=<unsubscribeToken> (for one-click unsubscribe)
 * Or body: {} (for authenticated user)
 */
export async function unsubscribe(c: Context, store: SqliteStorePort): Promise<Response> {
  const token = c.req.query("token");
  let userId: string | null = null;

  if (token) {
    userId = verifyUnsubscribeToken(token);
    if (!userId) {
      return c.json({ error: "Invalid unsubscribe token" }, 400);
    }
  } else {
    userId = c.get("userId");
    if (!userId) {
      return c.json({ error: "Authentication required" }, 401);
    }
  }

  await unsubscribeUser(userId, store);

  // Return HTML for browser-based unsubscribe
  if (token) {
    return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribed - PokeSniper</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
           display: flex; align-items: center; justify-content: center; height: 100vh; 
           margin: 0; background: #f8f9fa; }
    .container { text-align: center; padding: 40px; background: white; 
                 border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #333; margin: 0 0 10px 0; }
    p { color: #6c757d; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>✓ Unsubscribed</h1>
    <p>You've been unsubscribed from the PokeSniper weekly newsletter.</p>
  </div>
</body>
</html>
    `);
  }

  return c.json({ unsubscribed: true }, 200);
}

/**
 * Get subscription status.
 * GET /v1/newsletter/subscription
 */
export async function getSubscription(
  c: Context,
  userId: string,
  store: SqliteStorePort,
): Promise<Response> {
  const status = await getSubscriptionStatus(userId, store);
  return c.json(status, 200);
}

/**
 * Admin: Create draft issue for current week.
 * POST /v1/newsletter/admin/draft
 */
export async function createDraft(
  c: Context,
  userId: string,
  store: SqliteStorePort,
): Promise<Response> {
  if (!(await isAdmin(userId, store))) {
    return c.json({ error: "Admin access required" }, 403);
  }

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(now);
  weekEnd.setHours(0, 0, 0, 0);

  const content = await generateNewsletterContent(weekStart, weekEnd, store);
  const issueId = await createDraftIssue(content, store);

  return c.json({ issueId, content }, 201);
}

/**
 * Admin: Get draft issue.
 * GET /v1/newsletter/admin/issues/:issueId
 */
export async function getIssue(
  c: Context,
  userId: string,
  store: SqliteStorePort,
): Promise<Response> {
  if (!(await isAdmin(userId, store))) {
    return c.json({ error: "Admin access required" }, 403);
  }

  const issueId = c.req.param("issueId");
  if (!issueId) {
    return c.json({ error: "Issue ID required" }, 400);
  }

  const issue = await store.db
    .select()
    .from(newsletterIssues)
    .where(eq(newsletterIssues.issueId, issueId))
    .get();

  if (!issue) {
    return c.json({ error: "Issue not found" }, 404);
  }

  return c.json(issue, 200);
}

/**
 * Admin: Preview issue as HTML.
 * GET /v1/newsletter/admin/issues/:issueId/preview
 */
export async function previewIssue(
  c: Context,
  userId: string,
  store: SqliteStorePort,
): Promise<Response> {
  if (!(await isAdmin(userId, store))) {
    return c.json({ error: "Admin access required" }, 403);
  }

  const issueId = c.req.param("issueId");
  if (!issueId) {
    return c.json({ error: "Issue ID required" }, 400);
  }

  const issue = await store.db
    .select()
    .from(newsletterIssues)
    .where(eq(newsletterIssues.issueId, issueId))
    .get();

  if (!issue) {
    return c.json({ error: "Issue not found" }, 404);
  }

  const content = JSON.parse(issue.contentSnapshot as string) as any;
  const mailingAddress = process.env.NEWSLETTER_MAILING_ADDRESS || "[MAILING ADDRESS NOT SET]";
  const html = renderNewsletterHtml(
    content,
    "https://app.pokesniper.app/settings?unsubscribe=true",
    mailingAddress,
  );

  return c.html(html);
}

/**
 * Admin: Send test issue to admin email.
 * POST /v1/newsletter/admin/issues/:issueId/test { email: string }
 */
export async function sendTest(
  c: Context,
  userId: string,
  store: SqliteStorePort,
  emailProvider: EmailProviderPort,
): Promise<Response> {
  if (!(await isAdmin(userId, store))) {
    return c.json({ error: "Admin access required" }, 403);
  }

  const issueId = c.req.param("issueId");
  if (!issueId) {
    return c.json({ error: "Issue ID required" }, 400);
  }

  const body = await c.req.json();
  const { email } = body;

  if (!email || typeof email !== "string") {
    return c.json({ error: "Email required" }, 400);
  }

  const issue = await store.db
    .select()
    .from(newsletterIssues)
    .where(eq(newsletterIssues.issueId, issueId))
    .get();

  if (!issue) {
    return c.json({ error: "Issue not found" }, 404);
  }

  const content = JSON.parse(issue.contentSnapshot as string) as any;
  const mailingAddress = process.env.NEWSLETTER_MAILING_ADDRESS || "[MAILING ADDRESS NOT SET]";
  const fromAddress = process.env.NEWSLETTER_FROM || "newsletter@pokesniper.app";
  const baseUrl = process.env.BASE_URL || "https://api.pokesniper.app";
  const unsubscribeUrl = `${baseUrl}/v1/newsletter/unsubscribe?token=${generateUnsubscribeToken(userId)}`;

  const html = renderNewsletterHtml(content, unsubscribeUrl, mailingAddress);

  const result = await emailProvider.send({
    to: email,
    from: fromAddress,
    subject: `[TEST] PokeSniper Weekly - ${new Date(content.weekStart).toLocaleDateString("en-US", { month: "long", day: "numeric" })}`,
    html,
  });

  if (!result.success) {
    return c.json({ error: result.error }, 500);
  }

  return c.json({ sent: true, messageId: result.messageId, dryRun: result.dryRun }, 200);
}

/**
 * Admin: Approve and send issue to all subscribers.
 * POST /v1/newsletter/admin/issues/:issueId/approve-send
 */
export async function approveAndSend(
  c: Context,
  userId: string,
  store: SqliteStorePort,
  emailProvider: EmailProviderPort,
): Promise<Response> {
  if (!(await isAdmin(userId, store))) {
    return c.json({ error: "Admin access required" }, 403);
  }

  const issueId = c.req.param("issueId");
  if (!issueId) {
    return c.json({ error: "Issue ID required" }, 400);
  }

  // Approve issue
  const approvalResult = await approveIssue(issueId, userId, store);
  if (!approvalResult.success) {
    return c.json({ error: approvalResult.error }, 400);
  }

  // Send to subscribers
  const baseUrl = process.env.BASE_URL || "https://api.pokesniper.app";
  const fromAddress = process.env.NEWSLETTER_FROM || "newsletter@pokesniper.app";
  const mailingAddress = process.env.NEWSLETTER_MAILING_ADDRESS || "[MAILING ADDRESS NOT SET]";

  const sendResult = await sendIssue(
    issueId,
    store,
    emailProvider,
    baseUrl,
    fromAddress,
    mailingAddress,
  );

  if (!sendResult.success) {
    return c.json({ error: sendResult.error }, 500);
  }

  return c.json(
    {
      approved: true,
      sent: sendResult.sent,
      failed: sendResult.failed,
      skipped: sendResult.skipped,
    },
    200,
  );
}

/**
 * Admin: List all issues.
 * GET /v1/newsletter/admin/issues?limit=20&offset=0
 */
export async function listIssues(
  c: Context,
  userId: string,
  store: SqliteStorePort,
): Promise<Response> {
  if (!(await isAdmin(userId, store))) {
    return c.json({ error: "Admin access required" }, 403);
  }

  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const issues = await store.db
    .select()
    .from(newsletterIssues)
    .orderBy(newsletterIssues.createdAt)
    .limit(limit)
    .offset(offset)
    .all();

  return c.json({ issues }, 200);
}

/**
 * Webhook: Handle bounces and complaints from email provider.
 * POST /v1/newsletter/webhook/bounce
 * Body: { type: "bounce" | "complaint", messageId: string, email: string }
 */
export async function handleBounce(c: Context, store: SqliteStorePort): Promise<Response> {
  const body = await c.req.json();
  const { type, messageId, email } = body;

  if (!type || !messageId || !email) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  const now = new Date().toISOString();

  // Find send log entry
  const sendLog = await store.db
    .select()
    .from(newsletterSendLog)
    .where(eq(newsletterSendLog.providerMessageId, messageId))
    .get();

  if (sendLog) {
    if (type === "bounce") {
      await store.db
        .update(newsletterSendLog)
        .set({ bouncedAt: now, updatedAt: now })
        .where(eq(newsletterSendLog.sendId, sendLog.sendId))
        .run();
    } else if (type === "complaint") {
      await store.db
        .update(newsletterSendLog)
        .set({ complaintAt: now, updatedAt: now })
        .where(eq(newsletterSendLog.sendId, sendLog.sendId))
        .run();

      // Auto-unsubscribe on complaint
      await store.db
        .update(newsletterSubscriptions)
        .set({ unsubscribedAt: now, updatedAt: now })
        .where(eq(newsletterSubscriptions.email, email))
        .run();
    }
  }

  return c.json({ received: true }, 200);
}
