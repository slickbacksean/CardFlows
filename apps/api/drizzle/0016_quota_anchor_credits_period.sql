-- Sean: the allowance resets on the billing date (free: account creation date), no rollover.
-- Backend review M1: existing accounts keep this month's usage and their credits. They are
-- anchored to the start of the current UTC month, so the current period is exactly the
-- calendar month they were already in (resets on the 1st from then on). New accounts anchor
-- on their creation date.
ALTER TABLE `grade_accounts` ADD `anchor_at` text;
--> statement-breakpoint
ALTER TABLE `grade_accounts` ADD `billing_anchor_at` text;
--> statement-breakpoint
ALTER TABLE `grade_accounts` ADD `credits_period` text;
--> statement-breakpoint
-- Users with usage this month but no account row get one, so their usage isn't lost either.
INSERT OR IGNORE INTO `grade_accounts` (`user_id`, `plan`, `extra_credits`, `updated_at`)
SELECT DISTINCT `user_id`, 'free', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `grade_quota_usage` WHERE `month_key` = strftime('%Y-%m', 'now');
--> statement-breakpoint
UPDATE `grade_accounts`
SET `anchor_at` = strftime('%Y-%m-01T00:00:00.000Z', 'now'),
    `credits_period` = strftime('%Y-%m-01', 'now')
WHERE `anchor_at` IS NULL;
--> statement-breakpoint
-- This month's usage moves from the calendar key (YYYY-MM) to the period key (YYYY-MM-01).
INSERT OR IGNORE INTO `grade_quota_usage` (`user_id`, `month_key`, `used`)
SELECT `user_id`, strftime('%Y-%m-01', 'now'), `used`
FROM `grade_quota_usage` WHERE `month_key` = strftime('%Y-%m', 'now');
