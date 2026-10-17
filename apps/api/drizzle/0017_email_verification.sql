-- Sean: email verification before pre-grade estimates. Accounts that already exist (testers who
-- signed up before this) count as verified; invite-code testers have no user_accounts row and are
-- never asked. New sign-ups get a 6-digit code (one live code per user, 15 min, 5 tries).
ALTER TABLE `user_accounts` ADD `email_verified_at` text;
--> statement-breakpoint
UPDATE `user_accounts` SET `email_verified_at` = `created_at` WHERE `email_verified_at` IS NULL;
--> statement-breakpoint
CREATE TABLE `email_verification_codes` (
	`user_id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
