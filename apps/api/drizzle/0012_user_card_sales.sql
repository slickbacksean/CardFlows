CREATE TABLE `user_card_sales` (
	`user_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`sale_price_cents` integer NOT NULL,
	`sale_fees_cents` integer,
	`sale_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `inventory_item_id`)
);
