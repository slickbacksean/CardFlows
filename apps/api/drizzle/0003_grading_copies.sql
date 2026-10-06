CREATE TABLE `crm_grading_submitted` (
	`inventory_item_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`local_id` text,
	`image_url` text,
	`condition` text,
	`pillar_answers_json` text NOT NULL,
	`service_level_note` text NOT NULL DEFAULT '',
	`max_buy_amount` text,
	`estimate_json` text,
	`submitted_at` text NOT NULL,
	`order_number` text NOT NULL DEFAULT '',
	`company` text NOT NULL DEFAULT '',
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `crm_grading_returned` (
	`inventory_item_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`local_id` text,
	`image_url` text,
	`cert_number` text NOT NULL DEFAULT '',
	`returned_grade` text NOT NULL DEFAULT '',
	`returned_at` text NOT NULL
);
