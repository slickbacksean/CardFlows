ALTER TABLE `grade_accounts` ADD `anchor_at` text;
--> statement-breakpoint
ALTER TABLE `grade_accounts` ADD `billing_anchor_at` text;
--> statement-breakpoint
ALTER TABLE `grade_accounts` ADD `credits_period` text;
--> statement-breakpoint
UPDATE `grade_accounts` SET `anchor_at` = `updated_at` WHERE `anchor_at` IS NULL;
