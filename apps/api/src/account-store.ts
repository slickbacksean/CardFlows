/**
 * Open sign-up accounts, DB-backed guest sessions, and whole-user data moves/deletes.
 * Every multi-table change runs in one SQLite transaction.
 */
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { and, eq, isNull, lte } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { crmSessions, emailVerificationCodes, passwordResetTokens, schema, userAccounts } from "./db/schema";
import { hashSessionToken, mintSessionToken } from "./session";

export interface AccountRecord {
  userId: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  /** Null until the email is verified (only sign-ups from before #86 deployed are backfilled). */
  emailVerifiedAt?: string | null;
  verificationSends?: number;
}

/** Wrong guesses allowed per code before it stops working (a new code must be requested). */
export const EMAIL_CODE_MAX_ATTEMPTS = 5;

export type EmailCodeResult = "verified" | "invalid";

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
  /** True only for an account row with a verified email (invite testers are checked by ID in the API). */
  isEmailVerified(userId: string): boolean;
  /** Backend review M1: counts one verification send; false once `cap` sends were used. */
  takeVerificationSend(userId: string, cap: number): boolean;
  /** Backend review M1: counts one email to this address today (UTC); false at `cap`. Prunes old days. */
  takeEmailSendForAddress(email: string, day: string, cap: number): boolean;
  /** Accounts still unverified that were created before `cutoff` (purged after 7 days). */
  listUnverifiedAccountsBefore(cutoff: string): string[];
  /** Stores the hash of a new code; replaces any earlier code (only the newest works). */
  createEmailVerification(input: { userId: string; codeHash: string; expiresAt: string; at: string }): void;
  /** Single use: a match before expiry (and within EMAIL_CODE_MAX_ATTEMPTS) verifies the account. */
  confirmEmailVerification(userId: string, codeHash: string, now: string): EmailCodeResult;
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
  /** Backend review L3: one PII-free row per deletion (no user ID, email or token). */
  recordDeletionAudit(entry: DeletionAuditEntry): void;
  listDeletionAudit(): DeletionAuditEntry[];
}

export type DeletionAuditKind = "self" | "under18_report" | "unverified_purge" | "orphan_sweep";
export interface DeletionAuditEntry {
  at: string;
  kind: DeletionAuditKind;
  rowsDeleted: number;
}

/**
 * Backend review L1: email_send_counts keys on a hash of the normalized address, never the
 * address itself, so the per-address email cap survives an account delete without keeping the email.
 */
export function emailSendKey(email: string): string {
  return createHash("sha256").update(`cardflow-email-send\0${normalizeEmail(email)}`).digest("hex");
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
const NOT_MOVED = ["crm_sessions", "user_accounts", "password_reset_tokens", "email_verification_codes"];
/**
 * Policy Reviewer (Oct 17): guests never get CardSight and never attest 18+, so these guest rows
 * are deleted at sign-up instead of moved.
 */
const DROPPED_AT_SIGNUP = ["provider_consents", "consent_events", "cardsight_user_usage", "age_confirmations"];

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
    isEmailVerified(userId) {
      const row = db.select({ at: userAccounts.emailVerifiedAt }).from(userAccounts).where(eq(userAccounts.userId, userId)).get();
      return Boolean(row?.at);
    },
    takeVerificationSend(userId, cap) {
      return (
        sqlite
          .prepare("UPDATE user_accounts SET verification_sends = verification_sends + 1 WHERE user_id = ? AND verification_sends < ?")
          .run(userId, cap).changes === 1
      );
    },
    takeEmailSendForAddress(email, day, cap) {
      return sqlite.transaction(() => {
        const address = emailSendKey(email);
        sqlite.prepare("DELETE FROM email_send_counts WHERE day < date(?, '-1 day')").run(day);
        sqlite.prepare("INSERT OR IGNORE INTO email_send_counts (email, day, count) VALUES (?, ?, 0)").run(address, day);
        return (
          sqlite.prepare("UPDATE email_send_counts SET count = count + 1 WHERE email = ? AND day = ? AND count < ?").run(address, day, cap)
            .changes === 1
        );
      })();
    },
    listUnverifiedAccountsBefore(cutoff) {
      return (
        sqlite.prepare("SELECT user_id FROM user_accounts WHERE email_verified_at IS NULL AND created_at < ?").all(cutoff) as Array<{
          user_id: string;
        }>
      ).map((row) => row.user_id);
    },
    createEmailVerification({ userId, codeHash, expiresAt, at }) {
      db.insert(emailVerificationCodes)
        .values({ userId, codeHash, createdAt: at, expiresAt, attempts: 0 })
        .onConflictDoUpdate({ target: emailVerificationCodes.userId, set: { codeHash, createdAt: at, expiresAt, attempts: 0 } })
        .run();
    },
    confirmEmailVerification(userId, codeHash, now) {
      return sqlite.transaction((): EmailCodeResult => {
        const row = db.select().from(emailVerificationCodes).where(eq(emailVerificationCodes.userId, userId)).get();
        if (!row || row.expiresAt <= now || row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) return "invalid";
        if (row.codeHash !== codeHash) {
          db.update(emailVerificationCodes).set({ attempts: row.attempts + 1 }).where(eq(emailVerificationCodes.userId, userId)).run();
          return "invalid";
        }
        db.delete(emailVerificationCodes).where(eq(emailVerificationCodes.userId, userId)).run();
        db.update(userAccounts).set({ emailVerifiedAt: now }).where(and(eq(userAccounts.userId, userId), isNull(userAccounts.emailVerifiedAt))).run();
        return "verified";
      })();
    },
    recordDeletionAudit({ at, kind, rowsDeleted }) {
      sqlite.prepare("INSERT INTO account_deletion_audit (at, kind, rows_deleted) VALUES (?, ?, ?)").run(at, kind, rowsDeleted);
    },
    listDeletionAudit() {
      return (
        sqlite.prepare("SELECT at, kind, rows_deleted FROM account_deletion_audit ORDER BY seq").all() as Array<{
          at: string;
          kind: DeletionAuditKind;
          rows_deleted: number;
        }>
      ).map((row) => ({ at: row.at, kind: row.kind, rowsDeleted: row.rows_deleted }));
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
          if (DROPPED_AT_SIGNUP.includes(table)) {
            sqlite.prepare(`DELETE FROM \`${table}\` WHERE user_id = ?`).run(fromUserId);
            continue;
          }
          moved[table] = sqlite.prepare(`UPDATE OR IGNORE \`${table}\` SET user_id = ? WHERE user_id = ?`).run(toUserId, fromUserId).changes;
          sqlite.prepare(`DELETE FROM \`${table}\` WHERE user_id = ?`).run(fromUserId);
        }
        sqlite.prepare("DELETE FROM crm_sessions WHERE user_id = ?").run(fromUserId);
        sqlite.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(fromUserId);
        sqlite.prepare("DELETE FROM email_verification_codes WHERE user_id = ?").run(fromUserId);
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
