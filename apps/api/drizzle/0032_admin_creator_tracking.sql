ALTER TABLE user_accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));--> statement-breakpoint
CREATE INDEX user_accounts_role_idx ON user_accounts(role);--> statement-breakpoint
CREATE TABLE admin_actions (
  action_id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  CHECK (action_type IN (
    'report_resolve', 'content_remove', 'user_suspend', 'user_ban',
    'creator_create', 'creator_update', 'creator_delete',
    'stats_export', 'admin_grant', 'admin_revoke'
  ))
);
--> statement-breakpoint
CREATE INDEX admin_actions_admin_idx ON admin_actions(admin_user_id, created_at);
--> statement-breakpoint
CREATE INDEX admin_actions_type_idx ON admin_actions(action_type, created_at);
--> statement-breakpoint
CREATE INDEX admin_actions_target_idx ON admin_actions(target_type, target_id);
--> statement-breakpoint
CREATE TABLE creators (
  creator_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  invite_code TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK (platform IN ('twitch', 'youtube', 'tiktok', 'instagram', 'twitter', 'facebook', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX creators_invite_code_uidx ON creators(invite_code) WHERE archived_at IS NULL;
--> statement-breakpoint
CREATE INDEX creators_platform_idx ON creators(platform);
--> statement-breakpoint
CREATE INDEX creators_archived_idx ON creators(archived_at);
--> statement-breakpoint
ALTER TABLE user_accounts ADD COLUMN creator_code TEXT;
--> statement-breakpoint
ALTER TABLE user_accounts ADD COLUMN creator_code_entered_at TEXT;
--> statement-breakpoint
CREATE INDEX user_accounts_creator_code_idx ON user_accounts(creator_code, created_at);
--> statement-breakpoint
CREATE TABLE creator_stats_snapshots (
  creator_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  signups_count INTEGER NOT NULL DEFAULT 0,
  verified_signups_count INTEGER NOT NULL DEFAULT 0,
  activated_users_count INTEGER NOT NULL DEFAULT 0,
  d7_retained_count INTEGER NOT NULL DEFAULT 0,
  total_scans INTEGER NOT NULL DEFAULT 0,
  total_purchases INTEGER NOT NULL DEFAULT 0,
  premium_conversions INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (creator_id, snapshot_date)
);
--> statement-breakpoint
CREATE INDEX creator_stats_date_idx ON creator_stats_snapshots(snapshot_date);
--> statement-breakpoint
CREATE TABLE admin_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX admin_sessions_token_hash ON admin_sessions(token_hash);
--> statement-breakpoint
CREATE INDEX admin_sessions_user_idx ON admin_sessions(user_id);
--> statement-breakpoint
CREATE INDEX admin_sessions_expiry_idx ON admin_sessions(expires_at);

