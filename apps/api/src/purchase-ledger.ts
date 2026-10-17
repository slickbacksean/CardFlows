import { and, eq, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { purchaseEvents, schema } from "./db/schema";

/**
 * Data Engineer review: append-only purchase ledger. A purchase is recorded when it is saved
 * and voided (never deleted) when the Purchased card is undone or removed. North Star counts
 * only non-voided rows. Account deletion removes the user's rows entirely.
 */
export interface PurchaseEventRecord {
  purchaseId: string;
  inventoryItemId: string;
  purchasedAt: string;
  recordedAt: string;
  voidedAt: string | null;
}

export interface PurchaseLedger {
  record(userId: string, input: { purchaseId: string; inventoryItemId: string; purchasedAt: string; at: string }): void;
  voidForItem(userId: string, inventoryItemId: string, at: string): number;
  list(userId: string): PurchaseEventRecord[];
  /** purchasedAt of every non-voided purchase. */
  activePurchaseTimes(userId: string): string[];
  deleteUser(userId: string): number;
}

export function createMemoryPurchaseLedger(): PurchaseLedger {
  const rows = new Map<string, PurchaseEventRecord & { userId: string }>();
  return {
    record(userId, input) {
      const existing = rows.get(input.purchaseId);
      rows.set(input.purchaseId, {
        userId,
        purchaseId: input.purchaseId,
        inventoryItemId: input.inventoryItemId,
        purchasedAt: input.purchasedAt,
        recordedAt: existing?.recordedAt ?? input.at,
        voidedAt: existing?.voidedAt ?? null,
      });
    },
    voidForItem(userId, inventoryItemId, at) {
      let count = 0;
      for (const row of rows.values()) {
        if (row.userId === userId && row.inventoryItemId === inventoryItemId && !row.voidedAt) {
          row.voidedAt = at;
          count += 1;
        }
      }
      return count;
    },
    list: (userId) =>
      [...rows.values()].filter((row) => row.userId === userId).map(({ userId: _u, ...row }) => ({ ...row })),
    activePurchaseTimes: (userId) =>
      [...rows.values()].filter((row) => row.userId === userId && !row.voidedAt).map((row) => row.purchasedAt),
    deleteUser(userId) {
      let count = 0;
      for (const [id, row] of rows) {
        if (row.userId === userId) {
          rows.delete(id);
          count += 1;
        }
      }
      return count;
    },
  };
}

export function createSqlitePurchaseLedger(db: BetterSQLite3Database<typeof schema>): PurchaseLedger {
  return {
    record(userId, input) {
      db.insert(purchaseEvents)
        .values({
          purchaseId: input.purchaseId,
          userId,
          inventoryItemId: input.inventoryItemId,
          purchasedAt: input.purchasedAt,
          recordedAt: input.at,
          voidedAt: null,
        })
        .onConflictDoUpdate({ target: purchaseEvents.purchaseId, set: { purchasedAt: input.purchasedAt } })
        .run();
    },
    voidForItem(userId, inventoryItemId, at) {
      return db
        .update(purchaseEvents)
        .set({ voidedAt: at })
        .where(
          and(
            eq(purchaseEvents.userId, userId),
            eq(purchaseEvents.inventoryItemId, inventoryItemId),
            isNull(purchaseEvents.voidedAt),
          ),
        )
        .run().changes;
    },
    list: (userId) =>
      db
        .select()
        .from(purchaseEvents)
        .where(eq(purchaseEvents.userId, userId))
        .all()
        .map(({ userId: _u, ...row }) => row),
    activePurchaseTimes: (userId) =>
      db
        .select({ purchasedAt: purchaseEvents.purchasedAt })
        .from(purchaseEvents)
        .where(and(eq(purchaseEvents.userId, userId), isNull(purchaseEvents.voidedAt)))
        .all()
        .map((row) => row.purchasedAt),
    deleteUser: (userId) => db.delete(purchaseEvents).where(eq(purchaseEvents.userId, userId)).run().changes,
  };
}
