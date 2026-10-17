-- Sean: the allowance resets on the billing date (free: account creation date), no rollover.
-- This migration only adds the columns and makes sure every known user has a grade_accounts row.
-- The anchors themselves are filled in by `backfillQuotaAnchors` (src/db/quota-anchor-backfill.ts),
-- run right after migrations: creation date, else the earliest known activity. It also carries this
-- month's usage and credits into the in-progress period, so nobody resets because of the deploy.
ALTER TABLE `grade_accounts` ADD `anchor_at` text;
--> statement-breakpoint
ALTER TABLE `grade_accounts` ADD `billing_anchor_at` text;
--> statement-breakpoint
ALTER TABLE `grade_accounts` ADD `credits_period` text;
--> statement-breakpoint
-- Signed-up accounts, users with scans, and users with usage this month get a row, so their
-- anchor comes from their history instead of the day they next open the app.
INSERT OR IGNORE INTO `grade_accounts` (`user_id`, `plan`, `extra_credits`, `updated_at`)
SELECT DISTINCT `user_id`, 'free', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM (
  SELECT `user_id` FROM `user_accounts`
  UNION SELECT `user_id` FROM `crm_scans`
  UNION SELECT `user_id` FROM `grade_quota_usage` WHERE `month_key` = strftime('%Y-%m', 'now')
);
