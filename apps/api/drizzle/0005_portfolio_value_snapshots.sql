CREATE TABLE `portfolio_value_snapshots` (
	`user_id` text NOT NULL,
	`snapshot_date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`priced_copies` integer NOT NULL,
	`total_copies` integer NOT NULL,
	`recorded_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `snapshot_date`)
);
