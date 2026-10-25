-- Add usernames (case-insensitive unique, 3-20 characters, reportable)
ALTER TABLE user_accounts ADD COLUMN username TEXT;--> statement-breakpoint
ALTER TABLE user_accounts ADD COLUMN username_lower TEXT;--> statement-breakpoint
ALTER TABLE user_accounts ADD COLUMN username_changed_at TEXT;--> statement-breakpoint
CREATE UNIQUE INDEX user_accounts_username_lower_uidx ON user_accounts(username_lower) WHERE username_lower IS NOT NULL;--> statement-breakpoint
-- Community settings (sharing defaults off, anonymous by default)
CREATE TABLE community_settings (
  user_id TEXT PRIMARY KEY,
  share_new INTEGER NOT NULL DEFAULT 0,
  show_as TEXT NOT NULL DEFAULT 'anonymous',
  share_price INTEGER NOT NULL DEFAULT 0,
  rules_accepted INTEGER NOT NULL DEFAULT 0,
  rules_accepted_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (show_as IN ('anonymous', 'username'))
);--> statement-breakpoint
-- Community posts (shared purchases)
CREATE TABLE community_posts (
  post_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  cardflow_card_id TEXT NOT NULL REFERENCES cardflow_cards(cardflow_card_id),
  inventory_item_id TEXT NOT NULL,
  price_paid_cents INTEGER,
  show_as TEXT NOT NULL,
  created_at TEXT NOT NULL,
  hidden_at TEXT,
  removed_at TEXT,
  FOREIGN KEY (cardflow_card_id) REFERENCES cardflow_cards(cardflow_card_id)
);--> statement-breakpoint
CREATE INDEX community_posts_created_idx ON community_posts(created_at DESC);--> statement-breakpoint
CREATE INDEX community_posts_user_idx ON community_posts(user_id);--> statement-breakpoint
CREATE INDEX community_posts_card_idx ON community_posts(cardflow_card_id);--> statement-breakpoint
-- Reactions (5 fixed emoji, one per user per post)
CREATE TABLE post_reactions (
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, post_id),
  FOREIGN KEY (post_id) REFERENCES community_posts(post_id),
  CHECK (emoji IN ('fire', 'eyes', 'gem', 'open_mouth', 'clap'))
);--> statement-breakpoint
CREATE INDEX post_reactions_post_idx ON post_reactions(post_id);--> statement-breakpoint
-- Comments (v2, text only, 280 chars max)
CREATE TABLE post_comments (
  comment_id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  hidden_at TEXT,
  removed_at TEXT,
  FOREIGN KEY (post_id) REFERENCES community_posts(post_id)
);--> statement-breakpoint
CREATE INDEX post_comments_post_idx ON post_comments(post_id, created_at);--> statement-breakpoint
CREATE INDEX post_comments_user_idx ON post_comments(user_id);--> statement-breakpoint
-- Reports (posts, comments, usernames)
CREATE TABLE content_reports (
  report_id TEXT PRIMARY KEY,
  reporter_user_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT,
  CHECK (target_type IN ('post', 'comment', 'username')),
  CHECK (reason IN ('spam', 'harassment', 'offensive', 'scam', 'other'))
);--> statement-breakpoint
CREATE INDEX content_reports_target_idx ON content_reports(target_type, target_id);--> statement-breakpoint
CREATE INDEX content_reports_created_idx ON content_reports(created_at);--> statement-breakpoint
CREATE INDEX content_reports_resolved_idx ON content_reports(resolved_at);--> statement-breakpoint
-- Blocks (two-way, immediate effect)
CREATE TABLE user_blocks (
  blocker_user_id TEXT NOT NULL,
  blocked_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_user_id, blocked_user_id)
);--> statement-breakpoint
CREATE INDEX user_blocks_blocked_idx ON user_blocks(blocked_user_id);--> statement-breakpoint
-- Comment rate limiting (10 per hour per user)
CREATE TABLE comment_rate_limits (
  user_id TEXT NOT NULL,
  hour_key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, hour_key)
);--> statement-breakpoint
-- Market data: price history snapshots for movers calculation
CREATE TABLE card_price_history (
  cardflow_card_id TEXT NOT NULL,
  source TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  sales_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (cardflow_card_id, source, window_end),
  FOREIGN KEY (cardflow_card_id) REFERENCES cardflow_cards(cardflow_card_id)
);--> statement-breakpoint
CREATE INDEX card_price_history_updated_idx ON card_price_history(updated_at);--> statement-breakpoint
-- Set trends index tracking
CREATE TABLE set_trend_snapshots (
  tcgdex_set_id TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  index_change_pct REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tcgdex_set_id, window_end)
);--> statement-breakpoint
CREATE INDEX set_trend_snapshots_updated_idx ON set_trend_snapshots(updated_at);--> statement-breakpoint
-- Reserved usernames
CREATE TABLE reserved_usernames (
  username_lower TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);--> statement-breakpoint
INSERT INTO reserved_usernames (username_lower, reason, created_at) VALUES
  ('admin', 'system', datetime('now')),
  ('pokesniper', 'system', datetime('now')),
  ('support', 'system', datetime('now')),
  ('moderator', 'system', datetime('now')),
  ('mod', 'system', datetime('now')),
  ('administrator', 'system', datetime('now')),
  ('official', 'system', datetime('now')),
  ('staff', 'system', datetime('now')),
  ('team', 'system', datetime('now')),
  ('help', 'system', datetime('now'));
