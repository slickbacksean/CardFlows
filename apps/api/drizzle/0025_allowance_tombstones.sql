-- Deleted-account allowance tombstone: HMAC of email + this month's used grades (no plaintext).
CREATE TABLE `allowance_tombstones` (
	`email_hmac` text PRIMARY KEY NOT NULL,
	`period_key` text NOT NULL,
	`used` integer NOT NULL,
	`deleted_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `allowance_tombstones_deleted_at_idx` ON `allowance_tombstones` (`deleted_at`);
