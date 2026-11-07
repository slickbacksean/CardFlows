-- Daily pokemontcg.io market-price snapshots for the Trending tab.
-- Store only card id + UTC date + finish + market cents, plus a mapping table
-- (pokemontcg.io id → TCGdex catalog id) and a run log for "prices as of".

CREATE TABLE `pokemon_tcg_id_map` (
	`pokemontcg_card_id` text PRIMARY KEY NOT NULL,
	`tcgdex_id` text,
	`mapping_status` text NOT NULL,
	`mapping_method` text NOT NULL,
	`set_id` text,
	`set_name` text,
	`number` text,
	`name` text,
	`image_url` text,
	`unmatched_reason` text,
	`updated_at` text NOT NULL,
	CHECK(`mapping_status` in ('matched', 'unmatched'))
);
--> statement-breakpoint
CREATE INDEX `pokemon_tcg_id_map_tcgdex_idx` ON `pokemon_tcg_id_map` (`tcgdex_id`);
--> statement-breakpoint
CREATE TABLE `pokemon_tcg_price_snapshots` (
	`pokemontcg_card_id` text NOT NULL,
	`snapshot_date` text NOT NULL,
	`variant` text NOT NULL,
	`market_price_cents` integer NOT NULL,
	`tcgplayer_updated_at` text,
	PRIMARY KEY(`pokemontcg_card_id`, `snapshot_date`, `variant`)
);
--> statement-breakpoint
CREATE INDEX `pokemon_tcg_price_snapshots_date_idx` ON `pokemon_tcg_price_snapshots` (`snapshot_date`);
--> statement-breakpoint
CREATE TABLE `pokemon_tcg_snapshot_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`snapshot_date` text,
	`pages_fetched` integer NOT NULL DEFAULT 0,
	`cards_seen` integer NOT NULL DEFAULT 0,
	`snapshots_written` integer NOT NULL DEFAULT 0,
	`matched` integer NOT NULL DEFAULT 0,
	`unmatched` integer NOT NULL DEFAULT 0,
	`max_tcgplayer_updated_at` text,
	`error` text
);
