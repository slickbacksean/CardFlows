-- Sean: CardFlow is 18+ only. The device checks birth month + year and discards them; the
-- server keeps only that the user confirmed 18+, when, and which gate version.
CREATE TABLE `age_confirmations` (
	`user_id` text PRIMARY KEY NOT NULL,
	`age_confirmed_18plus` integer NOT NULL,
	`confirmed_at` text NOT NULL,
	`version` text NOT NULL,
	CONSTRAINT "age_confirmations_true_chk" CHECK("age_confirmations"."age_confirmed_18plus" = 1)
);
