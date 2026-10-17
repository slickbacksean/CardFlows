/**
 * Open sign-up accounts, DB-backed guest sessions, and whole-user data moves/deletes.
 * Every multi-table change runs in one SQLite transaction.
 */
import type Database from "better-sqlite3";
import { and, eq, isNull, lte } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { crmSessions, passwordResetTokens, schema, userAccounts } from "./db/schema";
import { hashSessionToken, mintSessionToken } from "./session";

export interface AccountRecord {
  userId: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface MintedSession {
  token: string;
  userId: string;
  expiresAt: string;
}

export interface AccountStore {
  /** Null when the email is already registered. */
  createAccount(input: { email: string; passwordHash: string; at: string }): AccountRecord | null;
  findByEmail(email: string): AccountRecord | null;
  getAccount(userId: string): AccountRecord | null;
  /** Forgot password: stores a reset token hash (earlier unused tokens for the user are voided). */
  createPasswordReset(input: { userId: string; tokenHash: string; expiresAt: string; at: string }): void;
  /** Single use: marks the token used and returns its user, or null if unknown, used or expired. */
  consumePasswordReset(tokenHash: string, now: string): string | null;
  setPasswordHash(userId: string, passwordHash: string): void;
  /** Every signed-up account's user ID (North Star counts them with invited testers). */
  listAccountUserIds(): string[];
  /** Session row for any user (account, guest). Guests get `isGuest`. */
  mintSession(userId: string, input: { guest: boolean; expiresAt: string; at: string }): MintedSession;
  /** Removes expired guest sessions; returns the guest user IDs that now have no live session. */
  purgeExpiredGuestSessions(now: string): string[];
  hasLiveSession(userId: string, now: string): boolean;
  deleteSessionsForUser(userId: string): number;
  /** Moves a guest's scans (photos ride on the scan row) and confirm events to `toUserId`. */
  moveGuestData(fromUserId: string, toUserId: string): { scans: number; confirmEvents: number };
  /** Deletes every row keyed by this user_id, in every table, in one transaction. */
  deleteAllUserRows(userId: string): Record<string, number>;
  /** Test/ops helper: rows left for a user_id across every table. */
  countUserRows(userId: string): Record<string, number>;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Tables with a user_id column, found from the live schema so new tables are never missed. */
function userIdTables(sqlite: Database.Database): string[] {
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'")
    .all() as Array<{ name: string }>;
  return tables
    .map((t) => t.name)
    .filter((name) =>
      (sqlite.prepare(`PRAGMA table_info(\`${name}\`)`).all() as Array<{ name: string }>).some((c) => c.name === "user_id"),
    );
}

/** Guest data that is never moved to the new account (deleted instead). */
const NOT_MOVED = ["crm_sessions", "user_accounts", "password_reset_tokens"];

/** Children before parents so foreign keys (purchases → inventory, confirmations → scans) hold. */
const DELETE_FIRST = [
  "crm_purchases",
  "crm_listing_drafts",
  "crm_grading_submitted",
  "crm_grading_returned",
  "grade_estimate_cache",
  "grade_photo_objects",
  "grade_estimate_history",
  "user_card_sales",
  "crm_inventory_items",
  "crm_confirmations",
  "scan_confirm_events",
];

export function createSqliteAccountStore(
  sqlite: Database.Database,
  db: BetterSQLite3Database<typeof schema>,
): AccountStore {
  const toRecord = (row: typeof userAccounts.$inferSelect): AccountRecord => ({ ...row });
  const childDeletes = (userId: string, counts: Record<string, number>) => {
    // Child rows that carry no user_id of their own, keyed through the user's inventory/scans.
    const viaInventory = ["crm_purchases", "crm_listing_drafts"];
    for (const table of viaInventory) {
      const cols = (sqlite.prepare(`PRAGMA table_info(\`${table}\`)`).all() as Array<{ name: string }>).map((c) => c.name);
      if (cols.includes("user_id") || !cols.includes("inventory_item_id")) continue;
      counts[table] =
        (counts[table] ?? 0) +
        sqlite
          .prepare(`DELETE FROM \`${table}\` WHERE inventory_item_id IN (SELECT inventory_item_id FROM crm_inventory_items WHERE user_id = ?)`)
          .run(userId).changes;
    }
  };
  return {
    createAccount({ email, passwordHash, at }) {
      const normalized = normalizeEmail(email);
      const record: AccountRecord = { userId: `acct_${crypto.randomUUID()}`, email: normalized, passwordHash, createdAt: at };
      const inserted = db.insert(userAccounts).values(record).onConflictDoNothing().run();
      return inserted.changes === 1 ? record : null;
    },
    findByEmail(email) {
      const row = db.select().from(userAccounts).where(eq(userAccounts.email, normalizeEmail(email))).get();
      return row ? toRecord(row) : null;
    },
    createPasswordReset({ userId, tokenHash, expiresAt, at }) {
      sqlite.transaction(() => {
        db.update(passwordResetTokens)
          .set({ usedAt: at })
          .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)))
          .run();
        db.insert(passwordResetTokens).values({ tokenHash, userId, createdAt: at, expiresAt }).run();
      })();
    },
    consumePasswordReset(tokenHash, now) {
      return sqlite.transaction(() => {
        const row = db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash)).get();
        if (!row || row.usedAt || row.expiresAt <= now) return null;
        const updated = db
          .update(passwordResetTokens)
          .set({ usedAt: now })
          .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt)))
          .run();
        return updated.changes === 1 ? row.userId : null;
      })();
    },
    setPasswordHash(userId, passwordHash) {
      db.update(userAccounts).set({ passwordHash }).where(eq(userAccounts.userId, userId)).run();
    },
    listAccountUserIds() {
      return db.select({ userId: userAccounts.userId }).from(userAccounts).all().map((row) => row.userId);
    },
    getAccount(userId) {
      const row = db.select().from(userAccounts).where(eq(userAccounts.userId, userId)).get();
      return row ? toRecord(row) : null;
    },
    mintSession(userId, { guest, expiresAt, at }) {
      const token = mintSessionToken();
      db.insert(crmSessions)
        .values({ sessionId: crypto.randomUUID(), tokenHash: hashSessionToken(token), userId, createdAt: at, expiresAt, isGuest: guest })
        .run();
      return { token, userId, expiresAt };
    },
    purgeExpiredGuestSessions(now) {
      return sqlite.transaction(() => {
        const expired = db
          .select({ userId: crmSessions.userId })
          .from(crmSessions)
          .where(and(eq(crmSessions.isGuest, true), lte(crmSessions.expiresAt, now)))
          .all()
          .map((row) => row.userId);
        db.delete(crmSessions).where(and(eq(crmSessions.isGuest, true), lte(crmSessions.expiresAt, now))).run();
        return [...new Set(expired)];
      })();
    },
    hasLiveSession(userId, now) {
      const row = sqlite
        .prepare("SELECT 1 FROM crm_sessions WHERE user_id = ? AND expires_at > ? LIMIT 1")
        .get(userId, now);
      return Boolean(row);
    },
    deleteSessionsForUser(userId) {
      return db.delete(crmSessions).where(eq(crmSessions.userId, userId)).run().changes;
    },
    moveGuestData(fromUserId, toUserId) {
      // Data Engineer review: every table with a user_id (found from the live schema), so a new
      // table is never missed. Sessions, accounts and reset tokens are not moved; the guest's
      // sessions are deleted. UPDATE OR IGNORE keeps the account's own row where a table allows
      // one row per user (preferences, plan), then any guest leftovers are deleted.
      return sqlite.transaction(() => {
        const moved: Record<string, number> = {};
        for (const table of userIdTables(sqlite)) {
          if (NOT_MOVED.includes(table)) continue;
          moved[table] = sqlite.prepare(`UPDATE OR IGNORE \`${table}\` SET user_id = ? WHERE user_id = ?`).run(toUserId, fromUserId).changes;
          sqlite.prepare(`DELETE FROM \`${table}\` WHERE user_id = ?`).run(fromUserId);
        }
        sqlite.prepare("DELETE FROM crm_sessions WHERE user_id = ?").run(fromUserId);
        sqlite.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(fromUserId);
        return { scans: moved.crm_scans ?? 0, confirmEvents: moved.scan_confirm_events ?? 0 };
      })();
    },
    deleteAllUserRows(userId) {
      return sqlite.transaction(() => {
        const counts: Record<string, number> = {};
        childDeletes(userId, counts);
        const tables = userIdTables(sqlite);
        const ordered = [...DELETE_FIRST.filter((t) => tables.includes(t)), ...tables.filter((t) => !DELETE_FIRST.includes(t))];
        for (const table of ordered) {
          counts[table] = (counts[table] ?? 0) + sqlite.prepare(`DELETE FROM \`${table}\` WHERE user_id = ?`).run(userId).changes;
        }
        return counts;
      })();
    },
    countUserRows(userId) {
      const counts: Record<string, number> = {};
      for (const table of userIdTables(sqlite)) {
        counts[table] = (sqlite.prepare(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE user_id = ?`).get(userId) as { n: number }).n;
      }
      return counts;
    },
  };
}
