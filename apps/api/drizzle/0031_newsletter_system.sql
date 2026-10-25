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
