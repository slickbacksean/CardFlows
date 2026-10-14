CREATE TABLE `grade_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`extra_credits` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "grade_accounts_plan_chk" CHECK("plan" in ('free', 'premium'))
);
--> statement-breakpoint
CREATE TABLE `grade_quota_usage` (
	`user_id` text NOT NULL,
	`month_key` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `month_key`)
);
--> statement-breakpoint
CREATE TABLE `vendor_quota_usage` (
	`provider` text NOT NULL,
	`month_key` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`provider`, `month_key`)
);
