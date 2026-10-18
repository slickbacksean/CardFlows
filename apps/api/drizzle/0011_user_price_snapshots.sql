CREATE TABLE `user_price_snapshots` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tcgdex_id` text NOT NULL,
	`variant` text,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`entered_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_price_snapshots_card_idx` ON `user_price_snapshots` (`user_id`,`tcgdex_id`,`entered_at`);
