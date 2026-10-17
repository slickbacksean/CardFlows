import { and, eq, lt } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { idempotencyKeys, schema } from "./db/schema";

/** Backend review M3: the first 2xx answer to a queued write, kept 24 h across restarts. */
export interface StoredIdempotentResponse {
  bodyHash: string;
  status: number;
  response: string;
  createdAt: string;
}

export interface IdempotencyStore {
  get(userId: string, key: string): StoredIdempotentResponse | undefined;
  save(userId: string, key: string, record: StoredIdempotentResponse): void;
  /** Deletes records created before `beforeIso`. */
  prune(beforeIso: string): number;
  deleteUser(userId: string): number;
}

export function createMemoryIdempotencyStore(): IdempotencyStore {
  const rows = new Map<string, StoredIdempotentResponse & { userId: string }>();
  const k = (userId: string, key: string) => `${userId}\0${key}`;
  return {
    get: (userId, key) => {
      const row = rows.get(k(userId, key));
      return row ? { bodyHash: row.bodyHash, status: row.status, response: row.response, createdAt: row.createdAt } : undefined;
    },
    save: (userId, key, record) => {
      if (!rows.has(k(userId, key))) rows.set(k(userId, key), { ...record, userId });
    },
    prune: (beforeIso) => {
      let n = 0;
      for (const [id, row] of rows) if (row.createdAt < beforeIso && rows.delete(id)) n += 1;
      return n;
    },
    deleteUser: (userId) => {
      let n = 0;
      for (const [id, row] of rows) if (row.userId === userId && rows.delete(id)) n += 1;
      return n;
    },
  };
}

export function createSqliteIdempotencyStore(db: BetterSQLite3Database<typeof schema>): IdempotencyStore {
  return {
    get: (userId, key) => {
      const row = db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.idemKey, key)))
        .get();
      return row ? { bodyHash: row.bodyHash, status: row.status, response: row.response, createdAt: row.createdAt } : undefined;
    },
    save: (userId, key, record) => {
      db.insert(idempotencyKeys).values({ userId, idemKey: key, ...record }).onConflictDoNothing().run();
    },
    prune: (beforeIso) => db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, beforeIso)).run().changes,
    deleteUser: (userId) => db.delete(idempotencyKeys).where(eq(idempotencyKeys.userId, userId)).run().changes,
  };
}
