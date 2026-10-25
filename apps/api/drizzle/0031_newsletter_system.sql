CREATE TABLE `account_deletion_audit` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`rows_deleted` integer NOT NULL,
	CONSTRAINT "account_deletion_audit_kind_chk" CHECK("account_deletion_audit"."kind" in ('self', 'under18_report', 'unverified_purge', 'orphan_sweep'))
);
--> statement-breakpoint
CREATE TABLE `age_confirmations` (
	`user_id` text PRIMARY KEY NOT NULL,
	`age_confirmed_18plus` integer NOT NULL,
	`age_attested_at` text NOT NULL,
	`version` text NOT NULL,
	CONSTRAINT "age_confirmations_true_chk" CHECK("age_confirmations"."age_confirmed_18plus" = 1)
);
--> statement-breakpoint
CREATE TABLE `allowance_tombstones` (
	`email_hmac` text PRIMARY KEY NOT NULL,
	`period_key` text NOT NULL,
	`used` integer NOT NULL,
	`deleted_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `allowance_tombstones_deleted_at_idx` ON `allowance_tombstones` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `auth_identities` (
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text,
	`refresh_token_enc` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`provider`, `subject`)
);
--> statement-breakpoint
CREATE INDEX `auth_identities_user_idx` ON `auth_identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `card_price_history` (
	`cardflow_card_id` text NOT NULL,
	`source` text NOT NULL,
	`window_start` text NOT NULL,
	`window_end` text NOT NULL,
	`price_cents` integer NOT NULL,
	`sales_count` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`cardflow_card_id`, `source`, `window_end`),
	FOREIGN KEY (`cardflow_card_id`) REFERENCES `cardflow_cards`(`cardflow_card_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `card_price_history_updated_idx` ON `card_price_history` (`updated_at`);--> statement-breakpoint
CREATE TABLE `cardsight_user_usage` (
	`user_id` text NOT NULL,
	`month_key` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `month_key`)
);
--> statement-breakpoint
CREATE TABLE `comment_rate_limits` (
	`user_id` text NOT NULL,
	`hour_key` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `hour_key`)
);
--> statement-breakpoint
CREATE TABLE `community_posts` (
	`post_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`cardflow_card_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`price_paid_cents` integer,
	`show_as` text NOT NULL,
	`created_at` text NOT NULL,
	`hidden_at` text,
	`removed_at` text,
	FOREIGN KEY (`cardflow_card_id`) REFERENCES `cardflow_cards`(`cardflow_card_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `community_posts_created_idx` ON `community_posts` (`created_at`);--> statement-breakpoint
CREATE INDEX `community_posts_user_idx` ON `community_posts` (`user_id`);--> statement-breakpoint
CREATE INDEX `community_posts_card_idx` ON `community_posts` (`cardflow_card_id`);--> statement-breakpoint
CREATE TABLE `community_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`share_new` integer DEFAULT false NOT NULL,
	`show_as` text DEFAULT 'anonymous' NOT NULL,
	`share_price` integer DEFAULT false NOT NULL,
	`rules_accepted` integer DEFAULT false NOT NULL,
	`rules_accepted_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "community_settings_show_as_chk" CHECK("community_settings"."show_as" in ('anonymous', 'username'))
);
--> statement-breakpoint
CREATE TABLE `consent_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`kind` text NOT NULL,
	`version` text NOT NULL,
	`at` text NOT NULL,
	CONSTRAINT "consent_events_kind_chk" CHECK("consent_events"."kind" in ('grant', 'decline', 'withdraw'))
);
--> statement-breakpoint
CREATE INDEX `consent_events_user_idx` ON `consent_events` (`user_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `consent_events_event_id` ON `consent_events` (`event_id`);--> statement-breakpoint
CREATE TABLE `content_reports` (
	`report_id` text PRIMARY KEY NOT NULL,
	`reporter_user_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolution` text,
	CONSTRAINT "content_reports_target_type_chk" CHECK("content_reports"."target_type" in ('post', 'comment', 'username')),
	CONSTRAINT "content_reports_reason_chk" CHECK("content_reports"."reason" in ('spam', 'harassment', 'offensive', 'scam', 'other'))
);
--> statement-breakpoint
CREATE INDEX `content_reports_target_idx` ON `content_reports` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `content_reports_created_idx` ON `content_reports` (`created_at`);--> statement-breakpoint
CREATE INDEX `content_reports_resolved_idx` ON `content_reports` (`resolved_at`);--> statement-breakpoint
CREATE TABLE `email_send_counts` (
	`email` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`email`, `day`)
);
--> statement-breakpoint
CREATE TABLE `email_verification_codes` (
	`user_id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `grade_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`extra_credits` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	`anchor_at` text,
	`billing_anchor_at` text,
	`credits_period` text,
	CONSTRAINT "grade_accounts_plan_chk" CHECK("grade_accounts"."plan" in ('free', 'premium'))
);
--> statement-breakpoint
CREATE TABLE `grade_estimate_cache` (
	`user_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`photo_hash` text NOT NULL,
	`estimate_json` text NOT NULL,
	PRIMARY KEY(`user_id`, `inventory_item_id`)
);
--> statement-breakpoint
CREATE TABLE `grade_estimate_history` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`overall` real NOT NULL,
	`confidence` text,
	`recorded_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `grade_estimate_history_item_idx` ON `grade_estimate_history` (`user_id`,`inventory_item_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `grade_photo_objects` (
	`user_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`side` text NOT NULL,
	`storage_ref` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `inventory_item_id`, `side`)
);
--> statement-breakpoint
CREATE TABLE `grade_quota_usage` (
	`user_id` text NOT NULL,
	`month_key` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `month_key`)
);
--> statement-breakpoint
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
CREATE INDEX `idempotency_keys_created_idx` ON `idempotency_keys` (`created_at`);--> statement-breakpoint
CREATE TABLE `newsletter_issues` (
	`issue_id` text PRIMARY KEY NOT NULL,
	`week_start` text NOT NULL,
	`week_end` text NOT NULL,
	`status` text NOT NULL,
	`content_snapshot` text,
	`created_at` text NOT NULL,
	`approved_at` text,
	`approved_by` text,
	`sent_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `newsletter_send_log` (
	`send_id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`status` text NOT NULL,
	`provider_message_id` text,
	`sent_at` text,
	`bounced_at` text,
	`complaint_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `newsletter_issues`(`issue_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `newsletter_send_log_issue_idx` ON `newsletter_send_log` (`issue_id`);--> statement-breakpoint
CREATE INDEX `newsletter_send_log_user_idx` ON `newsletter_send_log` (`user_id`);--> statement-breakpoint
CREATE TABLE `newsletter_subscriptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`subscribed_at` text NOT NULL,
	`unsubscribed_at` text,
	`unsubscribe_token` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `north_star_weekly_totals` (
	`week_start` text PRIMARY KEY NOT NULL,
	`purchased` integer DEFAULT 0 NOT NULL,
	`scans` integer DEFAULT 0 NOT NULL,
	`active_resellers` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE INDEX `password_reset_tokens_user_idx` ON `password_reset_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `pokecollector_pending_deletions` (
	`remote_user_id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_result` text
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `post_comments` (
	`comment_id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL,
	`hidden_at` text,
	`removed_at` text,
	FOREIGN KEY (`post_id`) REFERENCES `community_posts`(`post_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `post_comments_post_idx` ON `post_comments` (`post_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `post_comments_user_idx` ON `post_comments` (`user_id`);--> statement-breakpoint
CREATE TABLE `post_reactions` (
	`user_id` text NOT NULL,
	`post_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `post_id`),
	FOREIGN KEY (`post_id`) REFERENCES `community_posts`(`post_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "post_reactions_emoji_chk" CHECK("post_reactions"."emoji" in ('fire', 'eyes', 'gem', 'open_mouth', 'clap'))
);
--> statement-breakpoint
CREATE INDEX `post_reactions_post_idx` ON `post_reactions` (`post_id`);--> statement-breakpoint
CREATE TABLE `provider_consents` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`version` text NOT NULL,
	`granted_at` text,
	`declined_at` text,
	`withdrawn_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `provider`),
	CONSTRAINT "provider_consents_provider_chk" CHECK("provider_consents"."provider" in ('cardsight'))
);
--> statement-breakpoint
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
CREATE UNIQUE INDEX `purchase_events_event_id` ON `purchase_events` (`event_id`);--> statement-breakpoint
CREATE INDEX `purchase_events_user_purchased_idx` ON `purchase_events` (`user_id`,`purchased_at`);--> statement-breakpoint
CREATE INDEX `purchase_events_purchase_idx` ON `purchase_events` (`purchase_id`,`seq`);--> statement-breakpoint
CREATE INDEX `purchase_events_item_idx` ON `purchase_events` (`inventory_item_id`);--> statement-breakpoint
CREATE TABLE `reserved_usernames` (
	`username_lower` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
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
CREATE INDEX `scan_confirm_events_chosen_idx` ON `scan_confirm_events` (`chosen_tcgdex_id`);--> statement-breakpoint
CREATE INDEX `scan_confirm_events_created_idx` ON `scan_confirm_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `scan_confirm_events_user_idx` ON `scan_confirm_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `scan_confirm_events_user_created_idx` ON `scan_confirm_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `scan_confirm_events_scan_idx` ON `scan_confirm_events` (`scan_id`);--> statement-breakpoint
CREATE TABLE `set_trend_snapshots` (
	`tcgdex_set_id` text NOT NULL,
	`window_start` text NOT NULL,
	`window_end` text NOT NULL,
	`index_change_pct` real NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`tcgdex_set_id`, `window_end`)
);
--> statement-breakpoint
CREATE INDEX `set_trend_snapshots_updated_idx` ON `set_trend_snapshots` (`updated_at`);--> statement-breakpoint
CREATE TABLE `user_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`email_verified_at` text,
	`verification_sends` integer DEFAULT 0 NOT NULL,
	`terms_version` text,
	`terms_accepted_at` text,
	`username` text,
	`username_lower` text,
	`username_changed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_accounts_username_lower_uidx` ON `user_accounts` (`username_lower`) WHERE "user_accounts"."username_lower" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `user_accounts_email` ON `user_accounts` (`email`);--> statement-breakpoint
CREATE TABLE `user_blocks` (
	`blocker_user_id` text NOT NULL,
	`blocked_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`blocker_user_id`, `blocked_user_id`)
);
--> statement-breakpoint
CREATE INDEX `user_blocks_blocked_idx` ON `user_blocks` (`blocked_user_id`);--> statement-breakpoint
CREATE TABLE `user_card_sales` (
	`user_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`sale_price_cents` integer NOT NULL,
	`sale_fees_cents` integer,
	`sale_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `inventory_item_id`)
);
--> statement-breakpoint
CREATE INDEX `user_card_sales_sale_at_idx` ON `user_card_sales` (`sale_at`);--> statement-breakpoint
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
CREATE INDEX `user_price_snapshots_card_idx` ON `user_price_snapshots` (`user_id`,`tcgdex_id`,`entered_at`);--> statement-breakpoint
CREATE TABLE `vendor_quota_usage` (
	`provider` text NOT NULL,
	`month_key` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`provider`, `month_key`)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_crm_inventory_items` (
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
	CONSTRAINT "crm_inventory_items_intent_chk" CHECK("__new_crm_inventory_items"."intent" in ('purchased', 'watchlist')),
	CONSTRAINT "crm_inventory_items_workflow_state_chk" CHECK("__new_crm_inventory_items"."workflow_state" in ('watching', 'watchlist_closed', 'acquired', 'drafted', 'archived', 'details_needed'))
);
--> statement-breakpoint
INSERT INTO `__new_crm_inventory_items`("inventory_item_id", "user_id", "cardflow_card_id", "confirmation_id", "scan_id", "intent", "selected_variant", "condition", "quantity", "tags", "workflow_state", "target_max_buy_amount", "reference_price_amount", "closed_at", "created_at", "updated_at") SELECT "inventory_item_id", "user_id", "cardflow_card_id", "confirmation_id", "scan_id", "intent", "selected_variant", "condition", "quantity", "tags", "workflow_state", "target_max_buy_amount", "reference_price_amount", "closed_at", "created_at", "updated_at" FROM `crm_inventory_items`;--> statement-breakpoint
DROP TABLE `crm_inventory_items`;--> statement-breakpoint
ALTER TABLE `__new_crm_inventory_items` RENAME TO `crm_inventory_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `crm_inventory_items_watchlist_open_uidx` ON `crm_inventory_items` (`user_id`,`cardflow_card_id`,`selected_variant`) WHERE "crm_inventory_items"."intent" = 'watchlist' AND "crm_inventory_items"."closed_at" IS NULL;--> statement-breakpoint
CREATE TABLE `__new_crm_purchases` (
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
	CONSTRAINT "crm_purchases_reference_price_source_chk" CHECK("__new_crm_purchases"."reference_price_source" in ('user_entered', 'none'))
);
--> statement-breakpoint
INSERT INTO `__new_crm_purchases`("purchase_id", "inventory_item_id", "purchased_at", "source_note", "currency", "purchase_price", "shipping", "tax", "fees", "supplies", "all_in_total", "notes", "max_buy_amount", "reference_price_amount", "reference_price_source") SELECT "purchase_id", "inventory_item_id", "purchased_at", "source_note", "currency", "purchase_price", "shipping", "tax", "fees", "supplies", "all_in_total", "notes", "max_buy_amount", "reference_price_amount", "reference_price_source" FROM `crm_purchases`;--> statement-breakpoint
DROP TABLE `crm_purchases`;--> statement-breakpoint
ALTER TABLE `__new_crm_purchases` RENAME TO `crm_purchases`;--> statement-breakpoint
CREATE UNIQUE INDEX `crm_purchases_inventory_item_id` ON `crm_purchases` (`inventory_item_id`);--> statement-breakpoint
ALTER TABLE `crm_pokecollector_users` ADD `password_ciphertext` text;--> statement-breakpoint
ALTER TABLE `crm_scans` ADD `idempotency_body_hash` text;--> statement-breakpoint
ALTER TABLE `crm_sessions` ADD `is_guest` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `crm_sessions_guest_expiry_idx` ON `crm_sessions` (`is_guest`,`expires_at`);