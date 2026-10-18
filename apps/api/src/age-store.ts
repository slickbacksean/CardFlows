import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { AGE_GATE_VERSION, type AgeConfirmationState } from "@cardflow/shared";
import { ageConfirmations, schema } from "./db/schema";

/**
 * Sean (Oct 17): accounts state 18+ at sign-up. The server keeps only that confirmation, when,
 * and the statement version. Guests have no row.
 */
export interface AgeConfirmationRecord {
  ageConfirmed18Plus: true;
  ageAttestedAt: string;
  version: string;
}

export interface AgeConfirmationStore {
  get(userId: string): AgeConfirmationRecord | null;
  confirm(userId: string, version: string, at: string): AgeConfirmationRecord;
  deleteUser(userId: string): number;
}

export function ageConfirmationState(record: AgeConfirmationRecord | null): AgeConfirmationState {
  return {
    confirmed: Boolean(record?.ageConfirmed18Plus && record.version === AGE_GATE_VERSION),
    version: record?.version ?? null,
    attestedAt: record?.ageAttestedAt ?? null,
    currentVersion: AGE_GATE_VERSION,
  };
}

/** True when this account stated 18+ with the current sign-up statement version. */
export function hasAgeConfirmation(store: AgeConfirmationStore, userId: string): boolean {
  const record = store.get(userId);
  return Boolean(record?.ageConfirmed18Plus && record.version === AGE_GATE_VERSION);
}

export function createMemoryAgeConfirmationStore(): AgeConfirmationStore & {
  moveUser(fromUserId: string, toUserId: string): void;
} {
  const rows = new Map<string, AgeConfirmationRecord>();
  return {
    get: (userId) => {
      const row = rows.get(userId);
      return row ? { ...row } : null;
    },
    confirm(userId, version, at) {
      rows.set(userId, { ageConfirmed18Plus: true, ageAttestedAt: at, version });
      return { ...rows.get(userId)! };
    },
    deleteUser: (userId) => (rows.delete(userId) ? 1 : 0),
    /** Guests never attest (only accounts do), so nothing carries over; any guest row is dropped. */
    moveUser(fromUserId) {
      rows.delete(fromUserId);
    },
  };
}

export function createSqliteAgeConfirmationStore(db: BetterSQLite3Database<typeof schema>): AgeConfirmationStore {
  const get = (userId: string): AgeConfirmationRecord | null => {
    const row = db.select().from(ageConfirmations).where(eq(ageConfirmations.userId, userId)).get();
    return row?.ageConfirmed18Plus ? { ageConfirmed18Plus: true, ageAttestedAt: row.ageAttestedAt, version: row.version } : null;
  };
  return {
    get,
    confirm(userId, version, at) {
      db.insert(ageConfirmations)
        .values({ userId, ageConfirmed18Plus: true, ageAttestedAt: at, version })
        .onConflictDoUpdate({ target: ageConfirmations.userId, set: { ageConfirmed18Plus: true, ageAttestedAt: at, version } })
        .run();
      return get(userId)!;
    },
    deleteUser: (userId) => db.delete(ageConfirmations).where(eq(ageConfirmations.userId, userId)).run().changes,
  };
}
