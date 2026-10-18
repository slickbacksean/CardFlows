CREATE TABLE `grade_estimate_history` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`overall` real NOT NULL,
	`confidence` text,
	`recorded_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `grade_estimate_history_item_idx` ON `grade_estimate_history` (`user_id`,`inventory_item_id`,`recorded_at`);
