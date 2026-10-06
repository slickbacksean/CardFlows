CREATE TABLE `crm_pokecollector_users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`pokecollector_user_id` text NOT NULL,
	`pokecollector_username` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_pokecollector_users_pokecollector_user_id` ON `crm_pokecollector_users` (`pokecollector_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `crm_pokecollector_users_pokecollector_username` ON `crm_pokecollector_users` (`pokecollector_username`);