-- Sean: email verification before pre-grade estimates. New sign-ups get a 6-digit code (one live
-- code per user, 15 min, 5 tries). Backend review M3: only accounts created before open sign-up
-- (#86) deployed (2026-10-16 20:01 PT = 2026-10-17T03:01:00Z) count as verified; anyone who signed
-- up after that verifies like everyone else. Invite testers are verified by ID in the API.
ALTER TABLE `user_accounts` ADD `email_verified_at` text;
--> statement-breakpoint
ALTER TABLE `user_accounts` ADD `verification_sends` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `user_accounts` SET `email_verified_at` = `created_at`
WHERE `email_verified_at` IS NULL AND `created_at` < '2026-10-17T03:01:00.000Z';
--> statement-breakpoint
CREATE TABLE `email_verification_codes` (
	`user_id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- Backend review M1: emails sent per address per UTC day (verification + reset). Rows older than
-- yesterday are pruned on every send, so addresses don't linger here.
CREATE TABLE `email_send_counts` (
	`email` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`email`, `day`)
);
