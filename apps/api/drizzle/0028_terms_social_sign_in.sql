-- Sean (Oct 19): sign-up stores the accepted Terms of Service version and time, and accounts can
-- sign in with Apple or Google (verified provider subject linked to the account).
ALTER TABLE `user_accounts` ADD `terms_version` text;--> statement-breakpoint
ALTER TABLE `user_accounts` ADD `terms_accepted_at` text;--> statement-breakpoint
CREATE TABLE `auth_identities` (
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`provider`, `subject`)
);--> statement-breakpoint
CREATE INDEX `auth_identities_user_idx` ON `auth_identities` (`user_id`);
