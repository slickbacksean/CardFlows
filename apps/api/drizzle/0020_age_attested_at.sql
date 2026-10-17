-- Sean (Oct 17): no birth-date screen. Accounts attest 18+ at sign-up (required checkbox), or
-- testers/existing accounts confirm in the app before CardSight. Policy Reviewer: the column is
-- `age_attested_at` (plus the wording version).
ALTER TABLE `age_confirmations` RENAME COLUMN `confirmed_at` TO `age_attested_at`;
