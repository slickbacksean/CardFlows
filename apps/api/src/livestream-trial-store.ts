import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { livestreamTrials, schema } from "./db/schema";

export interface LivestreamTrialRecord {
  startedAt: string;
}

export interface LivestreamTrialStore {
  get(userId: string): LivestreamTrialRecord | null;
  /** Start the trial if none exists. Returns the (existing or new) row. */
  start(userId: string, at: string): LivestreamTrialRecord;
  deleteUser(userId: string): number;
}

export function createMemoryLivestreamTrialStore(): LivestreamTrialStore {
  const rows = new Map<string, LivestreamTrialRecord>();
  return {
    get: (userId) => {
      const row = rows.get(userId);
      return row ? { ...row } : null;
    },
    start(userId, at) {
      const existing = rows.get(userId);
      if (existing) return { ...existing };
      rows.set(userId, { startedAt: at });
      return { startedAt: at };
    },
    deleteUser: (userId) => (rows.delete(userId) ? 1 : 0),
  };
}

export function createSqliteLivestreamTrialStore(
  db: BetterSQLite3Database<typeof schema>,
): LivestreamTrialStore {
  const get = (userId: string): LivestreamTrialRecord | null => {
    const row = db.select().from(livestreamTrials).where(eq(livestreamTrials.userId, userId)).get();
    return row ? { startedAt: row.startedAt } : null;
  };
  return {
    get,
    start(userId, at) {
      const existing = get(userId);
      if (existing) return existing;
      db.insert(livestreamTrials).values({ userId, startedAt: at }).run();
      return get(userId)!;
    },
    deleteUser: (userId) =>
      db.delete(livestreamTrials).where(eq(livestreamTrials.userId, userId)).run().changes,
  };
}
