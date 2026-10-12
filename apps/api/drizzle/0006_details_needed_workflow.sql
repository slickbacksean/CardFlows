CREATE TABLE `crm_inventory_items_new` (
	`inventory_item_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`cardflow_card_id` text NOT NULL,
	`confirmation_id` text NOT NULL,
	`scan_id` text,
	`intent` text NOT NULL,
	`selected_variant` text,
	`condition` text,
	`quantity` integer,
	`tags` text DEFAULT '["raw"]' NOT NULL,
	`workflow_state` text NOT NULL,
	`target_max_buy_amount` integer,
	`reference_price_amount` integer,
	`closed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`cardflow_card_id`) REFERENCES `cardflow_cards`(`cardflow_card_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmation_id`) REFERENCES `crm_confirmations`(`confirmation_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scan_id`) REFERENCES `crm_scans`(`scan_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "crm_inventory_items_intent_chk" CHECK("intent" in ('purchased', 'watchlist')),
	CONSTRAINT "crm_inventory_items_workflow_state_chk" CHECK("workflow_state" in ('watching', 'watchlist_closed', 'acquired', 'drafted', 'archived', 'details_needed'))
);
--> statement-breakpoint
INSERT INTO `crm_inventory_items_new` SELECT * FROM `crm_inventory_items`;
--> statement-breakpoint
DROP TABLE `crm_inventory_items`;
--> statement-breakpoint
ALTER TABLE `crm_inventory_items_new` RENAME TO `crm_inventory_items`;
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_inventory_items_watchlist_open_uidx` ON `crm_inventory_items` (`user_id`,`cardflow_card_id`,`selected_variant`) WHERE "crm_inventory_items"."intent" = 'watchlist' AND "crm_inventory_items"."closed_at" IS NULL;
