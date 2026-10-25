-- Admin sessions with CSRF tokens and 8-hour TTL
-- Sean (Oct 25): Secure admin sessions for web admin dashboard

CREATE TABLE `admin_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`csrf_token` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);

CREATE UNIQUE INDEX `admin_sessions_token_hash` ON `admin_sessions` (`token_hash`);
CREATE INDEX `admin_sessions_user_idx` ON `admin_sessions` (`user_id`);
CREATE INDEX `admin_sessions_expiry_idx` ON `admin_sessions` (`expires_at`);
