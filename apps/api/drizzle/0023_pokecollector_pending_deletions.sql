-- Backend re-review H1 (P4): PokéCollector users to delete after an account delete (remote ID only).
CREATE TABLE `pokecollector_pending_deletions` (
	`remote_user_id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_result` text
);
