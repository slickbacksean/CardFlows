-- Sean (Oct 18): livestream scanner is free for 3 days from first use, then Premium.
-- Started at first identify/guesses call; deleted with the account.
CREATE TABLE `livestream_trials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL
);
