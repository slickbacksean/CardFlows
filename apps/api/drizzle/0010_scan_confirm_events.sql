CREATE TABLE `scan_confirm_events` (
	`event_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scan_id` text NOT NULL,
	`user_id` text NOT NULL,
	`via` text NOT NULL,
	`shown_tcgdex_ids_json` text NOT NULL,
	`chosen_tcgdex_id` text NOT NULL,
	`chosen_rank` integer,
	`selected_variant` text,
	`confidence` text,
	`recognition_provider` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scan_confirm_events_chosen_idx` ON `scan_confirm_events` (`chosen_tcgdex_id`);
--> statement-breakpoint
CREATE INDEX `scan_confirm_events_created_idx` ON `scan_confirm_events` (`created_at`);
--> statement-breakpoint
CREATE INDEX `scan_confirm_events_user_idx` ON `scan_confirm_events` (`user_id`);
