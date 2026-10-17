-- Data Engineer review: append-only purchase ledger. Every save that changes a purchase adds a
-- row with a full snapshot; undo adds one "voided" row. Rows are never updated or deleted,
-- except that account deletion anonymizes them (so past North Star weeks don't shift).
CREATE TABLE `purchase_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`user_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`kind` text NOT NULL,
	`purchased_at` text NOT NULL,
	`snapshot` text,
	`at` text NOT NULL,
	CONSTRAINT "purchase_events_kind_chk" CHECK("purchase_events"."kind" in ('recorded', 'edited', 'voided'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_events_event_id` ON `purchase_events` (`event_id`);
--> statement-breakpoint
CREATE INDEX `purchase_events_user_purchased_idx` ON `purchase_events` (`user_id`,`purchased_at`);
--> statement-breakpoint
CREATE INDEX `purchase_events_purchase_idx` ON `purchase_events` (`purchase_id`,`seq`);
--> statement-breakpoint
CREATE INDEX `purchase_events_item_idx` ON `purchase_events` (`inventory_item_id`);
--> statement-breakpoint
-- One-time backfill: every purchase that exists today becomes a "recorded" event. Purchases
-- undone before this migration were hard-deleted and cannot be recovered.
INSERT INTO `purchase_events` (`event_id`, `purchase_id`, `user_id`, `inventory_item_id`, `kind`, `purchased_at`, `snapshot`, `at`)
SELECT 'backfill-' || p.`purchase_id`, p.`purchase_id`, i.`user_id`, p.`inventory_item_id`, 'recorded', p.`purchased_at`,
  json_object('currency', p.`currency`, 'purchasePrice', p.`purchase_price`, 'shipping', p.`shipping`, 'tax', p.`tax`,
    'fees', p.`fees`, 'supplies', p.`supplies`, 'allInTotal', p.`all_in_total`, 'maxBuyAmount', p.`max_buy_amount`,
    'referencePriceAmount', p.`reference_price_amount`, 'backfilled', 1),
  p.`purchased_at`
FROM `crm_purchases` p JOIN `crm_inventory_items` i ON i.`inventory_item_id` = p.`inventory_item_id`;
--> statement-breakpoint
-- Backend review M2: the scan row keeps the request body hash so a replay after a restart can
-- still answer 422 for a different body.
ALTER TABLE `crm_scans` ADD `idempotency_body_hash` text;
--> statement-breakpoint
-- Backend review M3: queued-write idempotency survives restarts (24 h).
CREATE TABLE `idempotency_keys` (
	`user_id` text NOT NULL,
	`idem_key` text NOT NULL,
	`body_hash` text NOT NULL,
	`status` integer NOT NULL,
	`response` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `idem_key`)
);
--> statement-breakpoint
CREATE INDEX `idempotency_keys_created_idx` ON `idempotency_keys` (`created_at`);
