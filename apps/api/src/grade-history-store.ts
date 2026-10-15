import { and, asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { gradeEstimateHistory, schema } from "./db/schema";

/** P2-07 pre-grade estimate history. Always scoped by userId. */
export interface GradeHistoryRecord {
  entryId: string;
  inventoryItemId: string;
  overall: number;
  confidence: string | null;
  recordedAt: string;
}

export interface GradeHistoryStore {
  /** Oldest first. */
  list(userId: string, inventoryItemId: string): GradeHistoryRecord[];
  append(userId: string, record: GradeHistoryRecord): GradeHistoryRecord;
  deleteItem(userId: string, inventoryItemId: string): number;
  deleteUser(userId: string): number;
}

export function createMemoryGradeHistoryStore(): GradeHistoryStore {
  let rows: Array<GradeHistoryRecord & { userId: string }> = [];
  return {
    list: (userId, id) =>
      rows
        .filter((row) => row.userId === userId && row.inventoryItemId === id)
        .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
        .map(({ userId: _ignored, ...row }) => row),
    append: (userId, record) => {
      rows.push({ ...record, userId });
      return { ...record };
    },
    deleteItem: (userId, id) => {
      const before = rows.length;
      rows = rows.filter((row) => !(row.userId === userId && row.inventoryItemId === id));
      return before - rows.length;
    },
    deleteUser: (userId) => {
      const before = rows.length;
      rows = rows.filter((row) => row.userId !== userId);
      return before - rows.length;
    },
  };
}

export function createSqliteGradeHistoryStore(db: BetterSQLite3Database<typeof schema>): GradeHistoryStore {
  const t = gradeEstimateHistory;
  return {
    list: (userId, id) =>
      db
        .select()
        .from(t)
        .where(and(eq(t.userId, userId), eq(t.inventoryItemId, id)))
        .orderBy(asc(t.recordedAt))
        .all()
        .map((row) => ({
          entryId: row.entryId,
          inventoryItemId: row.inventoryItemId,
          overall: row.overall,
          confidence: row.confidence ?? null,
          recordedAt: row.recordedAt,
        })),
    append: (userId, record) => {
      db.insert(t).values({ ...record, userId }).onConflictDoNothing().run();
      return { ...record };
    },
    deleteItem: (userId, id) =>
      db.delete(t).where(and(eq(t.userId, userId), eq(t.inventoryItemId, id))).run().changes,
    deleteUser: (userId) => db.delete(t).where(eq(t.userId, userId)).run().changes,
  };
}
