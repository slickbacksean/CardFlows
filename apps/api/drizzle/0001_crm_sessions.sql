CREATE TABLE `crm_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_sessions_token_hash` ON `crm_sessions` (`token_hash`);