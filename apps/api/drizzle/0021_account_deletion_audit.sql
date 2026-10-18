-- Backend review L3 (P4): one row per account deletion with no PII (no user_id, email or token).
CREATE TABLE `account_deletion_audit` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`rows_deleted` integer NOT NULL,
	CONSTRAINT "account_deletion_audit_kind_chk" CHECK("account_deletion_audit"."kind" in ('self', 'under18_report', 'unverified_purge', 'orphan_sweep'))
);
