CREATE TABLE `grade_photo_objects` (
	`user_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`side` text NOT NULL,
	`storage_ref` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `inventory_item_id`, `side`)
);
