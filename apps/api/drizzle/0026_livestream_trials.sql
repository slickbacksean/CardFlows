-- Sean (Oct 18): livestream scanner trial table (first-use start).
-- Superseded by 0027: trial is now account created_at + 3 days; this table is dropped.
CREATE TABLE `livestream_trials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL
);
