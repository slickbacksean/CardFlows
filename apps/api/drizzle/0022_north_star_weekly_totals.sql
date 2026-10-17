-- Backend review H2 (P4): deleted accounts' weekly North Star counts as anonymous totals.
CREATE TABLE `north_star_weekly_totals` (
	`week_start` text PRIMARY KEY NOT NULL,
	`purchased` integer DEFAULT 0 NOT NULL,
	`scans` integer DEFAULT 0 NOT NULL,
	`active_resellers` integer DEFAULT 0 NOT NULL
);
