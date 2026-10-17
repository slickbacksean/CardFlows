-- Sean: CardSight disclosure + consent. A photo goes to CardSight only after the user agrees to
-- the current consent version. Backend review M4: a decline is `declined_at` (never a fake
-- grant), and every grant/decline/withdraw is appended to `consent_events`.
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
CREATE UNIQUE INDEX `consent_events_event_id` ON `consent_events` (`event_id`);
--> statement-breakpoint
CREATE INDEX `consent_events_user_idx` ON `consent_events` (`user_id`,`seq`);
--> statement-breakpoint
-- Backend review M5: per-user CardSight calls per calendar month.
CREATE TABLE `cardsight_user_usage` (
	`user_id` text NOT NULL,
	`month_key` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `month_key`)
);
