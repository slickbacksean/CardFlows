-- Sean: CardSight disclosure + consent. A photo goes to CardSight only after the user agrees to
-- the current consent version; withdrawing sets withdrawn_at. One row per user and provider.
CREATE TABLE `provider_consents` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`version` text NOT NULL,
	`granted_at` text NOT NULL,
	`withdrawn_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `provider`),
	CONSTRAINT "provider_consents_provider_chk" CHECK("provider_consents"."provider" in ('cardsight'))
);
