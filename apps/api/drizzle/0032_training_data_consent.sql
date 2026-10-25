-- Sean (Oct 25): Training data consent and retention for model improvement.
-- Consent is via accepting updated Terms (ON by default). Users can opt out via Settings toggle.
-- Training images: corrections, low-confidence, no-match. Kept 180 days or until used in training.
-- Cropped to card, EXIF stripped. Separate storage. Deleted on opt-out or account deletion.

CREATE TABLE `training_data_opt_outs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`opted_out_at` text NOT NULL
);

CREATE TABLE `scan_correction_feedback` (
	`feedback_id` text PRIMARY KEY NOT NULL,
	`pseudonymous_user_id` text NOT NULL,
	`scan_id` text NOT NULL,
	`chosen_cardflow_card_id` text NOT NULL,
	`chosen_tcgdex_id` text NOT NULL,
	`predicted_tcgdex_id` text,
	`confidence` text,
	`model_version` text NOT NULL,
	`recognition_provider` text NOT NULL,
	`was_correction` integer NOT NULL,
	`created_at` text NOT NULL,
	`training_image_id` text
);

CREATE TABLE `training_images` (
	`image_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pseudonymous_user_id` text NOT NULL,
	`scan_id` text NOT NULL,
	`retention_reason` text NOT NULL,
	`captured_at` text NOT NULL,
	`storage_ref` text NOT NULL,
	`image_mime_type` text NOT NULL,
	`expires_at` text NOT NULL,
	`terms_version` text NOT NULL,
	`used_in_training_at` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	CHECK(`retention_reason` in ('correction', 'low_confidence', 'no_match'))
);

CREATE INDEX `scan_correction_feedback_created_idx` ON `scan_correction_feedback` (`created_at`);
CREATE INDEX `scan_correction_feedback_pseudo_user_idx` ON `scan_correction_feedback` (`pseudonymous_user_id`);
CREATE INDEX `scan_correction_feedback_model_idx` ON `scan_correction_feedback` (`model_version`);
CREATE INDEX `training_images_user_idx` ON `training_images` (`user_id`);
CREATE INDEX `training_images_pseudo_user_idx` ON `training_images` (`pseudonymous_user_id`);
CREATE INDEX `training_images_expires_idx` ON `training_images` (`expires_at`);
CREATE INDEX `training_images_deleted_idx` ON `training_images` (`deleted_at`);
CREATE INDEX `training_images_retention_reason_idx` ON `training_images` (`retention_reason`);
