import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { AGE_GATE_VERSION, type AgeConfirmationState } from "@cardflow/shared";
import { ageConfirmations, schema } from "./db/schema";

/** Sean: 18+ only. The server keeps only that the user confirmed 18+, when, and the gate version. */
export interface AgeConfirmationRecord {
  ageConfirmed18Plus: true;
  confirmedAt: string;
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
    confirmedAt: record?.confirmedAt ?? null,
    currentVersion: AGE_GATE_VERSION,
  };
}

/** Checked before scans, photo uploads, sign-up and CardSight. */
export function hasAgeConfirmation(store: AgeConfirmationStore, userId: string): boolean {
  return ageConfirmationState(store.get(userId)).confirmed;
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
      rows.set(userId, { ageConfirmed18Plus: true, confirmedAt: at, version });
      return { ...rows.get(userId)! };
    },
    deleteUser: (userId) => (rows.delete(userId) ? 1 : 0),
    /** Guest sign-up: the guest's confirmation carries over unless the account already has one. */
    moveUser(fromUserId, toUserId) {
      const guest = rows.get(fromUserId);
      if (guest && !rows.has(toUserId)) rows.set(toUserId, guest);
      rows.delete(fromUserId);
    },
  };
}

export function createSqliteAgeConfirmationStore(db: BetterSQLite3Database<typeof schema>): AgeConfirmationStore {
  const get = (userId: string): AgeConfirmationRecord | null => {
    const row = db.select().from(ageConfirmations).where(eq(ageConfirmations.userId, userId)).get();
    return row?.ageConfirmed18Plus ? { ageConfirmed18Plus: true, confirmedAt: row.confirmedAt, version: row.version } : null;
  };
  return {
    get,
    confirm(userId, version, at) {
      db.insert(ageConfirmations)
        .values({ userId, ageConfirmed18Plus: true, confirmedAt: at, version })
        .onConflictDoUpdate({ target: ageConfirmations.userId, set: { ageConfirmed18Plus: true, confirmedAt: at, version } })
        .run();
      return get(userId)!;
    },
    deleteUser: (userId) => db.delete(ageConfirmations).where(eq(ageConfirmations.userId, userId)).run().changes,
  };
}
