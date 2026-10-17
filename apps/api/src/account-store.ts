/**
 * Open sign-up accounts, DB-backed guest sessions, and whole-user data moves/deletes.
 * Every multi-table change runs in one SQLite transaction.
 */
import type Database from "better-sqlite3";
import { and, eq, lte } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { crmSessions, schema, userAccounts } from "./db/schema";
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
      return sqlite.transaction(() => {
        const scans = sqlite.prepare("UPDATE crm_scans SET user_id = ? WHERE user_id = ?").run(toUserId, fromUserId).changes;
        const confirmEvents = sqlite
          .prepare("UPDATE scan_confirm_events SET user_id = ? WHERE user_id = ?")
          .run(toUserId, fromUserId).changes;
        sqlite.prepare("UPDATE crm_confirmations SET user_id = ? WHERE user_id = ?").run(toUserId, fromUserId);
        sqlite.prepare("DELETE FROM crm_sessions WHERE user_id = ?").run(fromUserId);
        return { scans, confirmEvents };
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
