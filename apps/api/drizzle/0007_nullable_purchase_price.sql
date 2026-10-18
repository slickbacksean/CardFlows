CREATE TABLE `crm_purchases_new` (
	`purchase_id` text PRIMARY KEY NOT NULL,
	`inventory_item_id` text NOT NULL,
	`purchased_at` text NOT NULL,
	`source_note` text,
	`currency` text DEFAULT 'USD' NOT NULL,
	`purchase_price` integer,
	`shipping` integer DEFAULT 0 NOT NULL,
	`tax` integer DEFAULT 0 NOT NULL,
	`fees` integer DEFAULT 0 NOT NULL,
	`supplies` integer DEFAULT 0 NOT NULL,
	`all_in_total` integer,
	`notes` text,
	`max_buy_amount` integer,
	`reference_price_amount` integer,
	`reference_price_source` text DEFAULT 'none' NOT NULL,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `crm_inventory_items`(`inventory_item_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "crm_purchases_reference_price_source_chk" CHECK("reference_price_source" in ('user_entered', 'none'))
);
--> statement-breakpoint
INSERT INTO `crm_purchases_new` SELECT * FROM `crm_purchases`;
--> statement-breakpoint
DROP TABLE `crm_purchases`;
--> statement-breakpoint
ALTER TABLE `crm_purchases_new` RENAME TO `crm_purchases`;
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_purchases_inventory_item_id` ON `crm_purchases` (`inventory_item_id`);
