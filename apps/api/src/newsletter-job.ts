/**
 * Sean (Oct 25): Weekly newsletter draft creation job.
 * Creates a draft issue every week without sending. Admin must preview, test, and approve before sending.
 */

import { generateNewsletterContent, createDraftIssue } from "./newsletter";
import type { SqliteStorePort } from "./sqlite-store";

export interface ScheduledJobConfig {
  /** Cron expression for weekly schedule (default: Mondays at 9 AM UTC) */
  cronSchedule?: string;
  /** Enable/disable the job (default: true) */
  enabled?: boolean;
}

export async function createWeeklyDraft(store: SqliteStorePort): Promise<{
  success: boolean;
  issueId?: string;
  error?: string;
}> {
  try {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(now);
    weekEnd.setHours(0, 0, 0, 0);

    console.log(
      `[NEWSLETTER] Creating draft for week ${weekStart.toISOString()} - ${weekEnd.toISOString()}`,
    );

    const content = await generateNewsletterContent(weekStart, weekEnd, store);
    const issueId = await createDraftIssue(content, store);

    console.log(`[NEWSLETTER] Draft created: ${issueId}`);

    return { success: true, issueId };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    console.error(`[NEWSLETTER] Failed to create draft:`, error);
    return { success: false, error };
  }
}

/**
 * Start the weekly newsletter job.
 * In production, this should be called by a cron service or scheduled task runner.
 * The job creates a draft issue only - it never sends automatically.
 */
export function startWeeklyNewsletterJob(
  store: SqliteStorePort,
  config: ScheduledJobConfig = {},
): { stop: () => void } | null {
  const enabled = config.enabled ?? process.env.NEWSLETTER_SCHEDULED_ENABLED === "true";

  if (!enabled) {
    console.log("[NEWSLETTER] Scheduled job disabled (NEWSLETTER_SCHEDULED_ENABLED != true)");
    return null;
  }

  // Default: Mondays at 9 AM UTC (cron: 0 9 * * 1)
  const schedule = config.cronSchedule ?? process.env.NEWSLETTER_CRON_SCHEDULE ?? "0 9 * * 1";

  console.log(`[NEWSLETTER] Scheduled job enabled with cron: ${schedule}`);

  // For now, we're just providing the infrastructure.
  // In production, integrate with a cron service like:
  // - node-cron (if running in-process)
  // - Railway cron
  // - GitHub Actions scheduled workflow
  // - External cron service calling POST /v1/newsletter/admin/draft
  
  console.log(`[NEWSLETTER] To schedule this job, use one of these methods:
  1. External cron: curl -X POST https://api.pokesniper.app/v1/newsletter/admin/draft -H "Authorization: Bearer <token>"
  2. Railway cron: Set schedule in railway.json
  3. GitHub Actions: .github/workflows/newsletter-draft.yml with schedule trigger
  4. Install node-cron: pnpm add node-cron @types/node-cron
  `);

  // Return no-op stop function
  return { stop: () => console.log("[NEWSLETTER] Scheduled job stopped") };
}
