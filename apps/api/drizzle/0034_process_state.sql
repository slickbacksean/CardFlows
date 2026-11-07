-- Restart-critical process state that used to live in in-memory Maps.
-- Rate/quota/abuse counters, deletion receipts, the 24 h recognition cache (CardSight cost),
-- and async pre-grade jobs (bodies live next to SQLite at grade/jobs/<job_id>.bin).

CREATE TABLE `rate_limit_buckets` (
	`bucket_id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limit_buckets_reset_idx` ON `rate_limit_buckets` (`reset_at`);
--> statement-breakpoint
CREATE TABLE `deleted_users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deletion_receipts` (
	`receipt_key` text PRIMARY KEY NOT NULL,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recognition_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`source` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recognition_cache_expires_idx` ON `recognition_cache` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `grade_jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`status` text NOT NULL,
	`retry_after_seconds` integer,
	`estimate_json` text,
	`error` text,
	`request_id` text,
	`inventory_item_id` text NOT NULL,
	`content_type` text,
	`url` text NOT NULL,
	`identity_json` text NOT NULL,
	CHECK(`status` in ('queued', 'running', 'waiting', 'done', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `grade_jobs_user_idx` ON `grade_jobs` (`user_id`);
--> statement-breakpoint
CREATE INDEX `grade_jobs_created_idx` ON `grade_jobs` (`created_at`);
