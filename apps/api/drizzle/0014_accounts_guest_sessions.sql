CREATE TABLE `user_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_accounts_email` ON `user_accounts` (`email`);
--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE INDEX `password_reset_tokens_user_idx` ON `password_reset_tokens` (`user_id`);
--> statement-breakpoint
ALTER TABLE `crm_sessions` ADD `is_guest` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `crm_sessions_guest_expiry_idx` ON `crm_sessions` (`is_guest`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `scan_confirm_events_user_created_idx` ON `scan_confirm_events` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `scan_confirm_events_scan_idx` ON `scan_confirm_events` (`scan_id`);
--> statement-breakpoint
CREATE INDEX `user_card_sales_sale_at_idx` ON `user_card_sales` (`sale_at`);
