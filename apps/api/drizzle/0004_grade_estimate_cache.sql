CREATE TABLE `grade_estimate_cache` (
	`user_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`photo_hash` text NOT NULL,
	`estimate_json` text NOT NULL,
	PRIMARY KEY(`user_id`, `inventory_item_id`)
);
