-- PokéCollector opaque per-user accounts: the per-link random password, encrypted at rest.
-- Legacy rows (email-derived usernames) keep NULL and are relinked by pokecollector-relink.
ALTER TABLE `crm_pokecollector_users` ADD `password_ciphertext` text;
