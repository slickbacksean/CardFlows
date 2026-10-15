import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { schema, userCardSales } from "./db/schema";

/** P2-03 sale records. Always scoped by userId. */
export interface CardSaleRecord {
  inventoryItemId: string;
  priceCents: number;
  feesCents: number | null;
  soldAt: string;
  updatedAt: string;
}

export interface SalesStore {
  list(userId: string): CardSaleRecord[];
  get(userId: string, inventoryItemId: string): CardSaleRecord | undefined;
  save(userId: string, record: CardSaleRecord): CardSaleRecord;
  delete(userId: string, inventoryItemId: string): boolean;
  deleteUser(userId: string): number;
}

export function createMemorySalesStore(): SalesStore {
  const rows = new Map<string, Map<string, CardSaleRecord>>();
  const forUser = (userId: string) => {
    let map = rows.get(userId);
    if (!map) rows.set(userId, (map = new Map()));
    return map;
  };
  return {
    list: (userId) => [...(rows.get(userId)?.values() ?? [])].map((row) => ({ ...row })),
    get: (userId, id) => {
      const row = rows.get(userId)?.get(id);
      return row ? { ...row } : undefined;
    },
    save: (userId, record) => {
      forUser(userId).set(record.inventoryItemId, { ...record });
      return { ...record };
    },
    delete: (userId, id) => rows.get(userId)?.delete(id) ?? false,
    deleteUser: (userId) => {
      const count = rows.get(userId)?.size ?? 0;
      rows.delete(userId);
      return count;
    },
  };
}

type Row = typeof userCardSales.$inferSelect;
const toRecord = (row: Row): CardSaleRecord => ({
  inventoryItemId: row.inventoryItemId,
  priceCents: row.salePriceCents,
  feesCents: row.saleFeesCents ?? null,
  soldAt: row.saleAt,
  updatedAt: row.updatedAt,
});

export function createSqliteSalesStore(db: BetterSQLite3Database<typeof schema>): SalesStore {
  const where = (userId: string, id: string) =>
    and(eq(userCardSales.userId, userId), eq(userCardSales.inventoryItemId, id));
  return {
    list: (userId) =>
      db.select().from(userCardSales).where(eq(userCardSales.userId, userId)).all().map(toRecord),
    get: (userId, id) => {
      const row = db.select().from(userCardSales).where(where(userId, id)).get();
      return row ? toRecord(row) : undefined;
    },
    save: (userId, record) => {
      const values = {
        salePriceCents: record.priceCents,
        saleFeesCents: record.feesCents,
        saleAt: record.soldAt,
        updatedAt: record.updatedAt,
      };
      db.insert(userCardSales)
        .values({ userId, inventoryItemId: record.inventoryItemId, ...values })
        .onConflictDoUpdate({ target: [userCardSales.userId, userCardSales.inventoryItemId], set: values })
        .run();
      return { ...record };
    },
    delete: (userId, id) => db.delete(userCardSales).where(where(userId, id)).run().changes > 0,
    deleteUser: (userId) => db.delete(userCardSales).where(eq(userCardSales.userId, userId)).run().changes,
  };
}
