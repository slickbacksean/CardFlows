CREATE TABLE `card_external_ids` (
	`id` text PRIMARY KEY NOT NULL,
	`cardflow_card_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`set_external_id` text,
	`language` text NOT NULL,
	`match_method` text NOT NULL,
	`mapping_confidence` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`cardflow_card_id`) REFERENCES `cardflow_cards`(`cardflow_card_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "card_external_ids_provider_chk" CHECK("card_external_ids"."provider" in ('tcgdex', 'cardsight'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_external_ids_provider_external_id_language` ON `card_external_ids` (`provider`,`external_id`,`language`);--> statement-breakpoint
CREATE TABLE `cardflow_cards` (
	`cardflow_card_id` text PRIMARY KEY NOT NULL,
	`language` text NOT NULL,
	`tcgdex_id` text NOT NULL,
	`tcgdex_set_id` text NOT NULL,
	`local_id` text NOT NULL,
	`name` text NOT NULL,
	`set_name` text NOT NULL,
	`rarity` text,
	`category` text NOT NULL,
	`variants_json` text NOT NULL,
	`image_base_url` text,
	`image_source` text DEFAULT 'tcgdex_assets' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cardflow_cards_language_tcgdex_id` ON `cardflow_cards` (`language`,`tcgdex_id`);--> statement-breakpoint
CREATE TABLE `crm_confirmations` (
	`confirmation_id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`user_id` text NOT NULL,
	`cardflow_card_id` text NOT NULL,
	`tcgdex_id` text NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`selected_variant` text,
	`match_method` text NOT NULL,
	`mapping_confidence` text,
	`previous_tcgdex_id` text,
	`confirmed_at` text NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `crm_scans`(`scan_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cardflow_card_id`) REFERENCES `cardflow_cards`(`cardflow_card_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `crm_inventory_items` (
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
	CONSTRAINT "crm_inventory_items_intent_chk" CHECK("crm_inventory_items"."intent" in ('purchased', 'watchlist')),
	CONSTRAINT "crm_inventory_items_workflow_state_chk" CHECK("crm_inventory_items"."workflow_state" in ('watching', 'watchlist_closed', 'acquired', 'drafted', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_inventory_items_watchlist_open_uidx` ON `crm_inventory_items` (`user_id`,`cardflow_card_id`,`selected_variant`) WHERE "crm_inventory_items"."intent" = 'watchlist' AND "crm_inventory_items"."closed_at" IS NULL;--> statement-breakpoint
CREATE TABLE `crm_listing_drafts` (
	`draft_id` text PRIMARY KEY NOT NULL,
	`inventory_item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`cardflow_card_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`condition` text,
	`asking_price` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`photos_json` text DEFAULT '[]' NOT NULL,
	`intended_channel_note` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`title_template_id` text DEFAULT 'default_en_raw_single' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `crm_inventory_items`(`inventory_item_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cardflow_card_id`) REFERENCES `cardflow_cards`(`cardflow_card_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "crm_listing_drafts_status_chk" CHECK("crm_listing_drafts"."status" in ('draft', 'ready_for_review'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_listing_drafts_inventory_item_id` ON `crm_listing_drafts` (`inventory_item_id`);--> statement-breakpoint
CREATE TABLE `crm_purchases` (
	`purchase_id` text PRIMARY KEY NOT NULL,
	`inventory_item_id` text NOT NULL,
	`purchased_at` text NOT NULL,
	`source_note` text,
	`currency` text DEFAULT 'USD' NOT NULL,
	`purchase_price` integer NOT NULL,
	`shipping` integer DEFAULT 0 NOT NULL,
	`tax` integer DEFAULT 0 NOT NULL,
	`fees` integer DEFAULT 0 NOT NULL,
	`supplies` integer DEFAULT 0 NOT NULL,
	`all_in_total` integer NOT NULL,
	`notes` text,
	`max_buy_amount` integer,
	`reference_price_amount` integer,
	`reference_price_source` text DEFAULT 'none' NOT NULL,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `crm_inventory_items`(`inventory_item_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "crm_purchases_reference_price_source_chk" CHECK("crm_purchases"."reference_price_source" in ('user_entered', 'none'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_purchases_inventory_item_id` ON `crm_purchases` (`inventory_item_id`);--> statement-breakpoint
CREATE TABLE `crm_scans` (
	`scan_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`captured_at` text NOT NULL,
	`capture_method` text NOT NULL,
	`image_storage_ref` text,
	`image_source` text DEFAULT 'user_capture' NOT NULL,
	`image_mime_type` text,
	`recognition_json` text NOT NULL,
	`mapping_json` text,
	`mapping_status` text,
	`mapping_confidence` text,
	`pre_inventory_state` text DEFAULT 'scan_captured' NOT NULL,
	`cardflow_card_id` text,
	`cardsight_card_id` text,
	`vendor_request_id` text,
	FOREIGN KEY (`cardflow_card_id`) REFERENCES `cardflow_cards`(`cardflow_card_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`default_currency` text DEFAULT 'USD' NOT NULL,
	`default_language` text DEFAULT 'en' NOT NULL,
	`max_buy_target_margin_pct` real DEFAULT 0.2 NOT NULL,
	`max_buy_fees_buffer_pct` real DEFAULT 0.13 NOT NULL,
	`max_buy_condition_adjustments_json` text,
	`default_inventory_tag` text DEFAULT 'raw' NOT NULL
);
