-- Data Engineer review: purchases are voided, not forgotten. Undoing a Purchased card still
-- deletes the crm_purchases row (it references the inventory item, which is removed), but the
-- append-only ledger keeps the purchase with voided_at set. North Star counts voided_at IS NULL.
CREATE TABLE `purchase_events` (
	`purchase_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`purchased_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`voided_at` text
);
--> statement-breakpoint
CREATE INDEX `purchase_events_user_purchased_idx` ON `purchase_events` (`user_id`,`purchased_at`);
--> statement-breakpoint
CREATE INDEX `purchase_events_item_idx` ON `purchase_events` (`inventory_item_id`);
--> statement-breakpoint
INSERT INTO `purchase_events` (`purchase_id`, `user_id`, `inventory_item_id`, `purchased_at`, `recorded_at`, `voided_at`)
SELECT p.`purchase_id`, i.`user_id`, p.`inventory_item_id`, p.`purchased_at`, p.`purchased_at`, NULL
FROM `crm_purchases` p JOIN `crm_inventory_items` i ON i.`inventory_item_id` = p.`inventory_item_id`;
