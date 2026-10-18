import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { purchaseEvents, schema } from "./db/schema";

/**
 * Data Engineer review: append-only purchase ledger. Each change is a new row; rows are never
 * updated in place. Backend review H2 (P4): account deletion hard-deletes the user's rows after
 * rolling their weekly counts into north_star_weekly_totals (anonymous totals, no IDs).
 * - "recorded": first save, with a full snapshot of the purchase (price, costs, Max Buy).
 * - "edited": a later save whose snapshot or date changed.
 * - "voided": the Purchased card was undone or removed. Written once per purchase, inside the
 *   same transaction that removes the crm_purchases row.
 * North Star counts purchases with no "voided" event, at their latest purchased_at.
 */
export type PurchaseEventKind = "recorded" | "edited" | "voided";

export interface PurchaseEventRecord {
  eventId: string;
  purchaseId: string;
  inventoryItemId: string;
  kind: PurchaseEventKind;
  purchasedAt: string;
  snapshot: string | null;
  at: string;
}

export interface PurchaseRecordInput {
  purchaseId: string;
  inventoryItemId: string;
  purchasedAt: string;
  /** Full purchase snapshot (JSON-serializable). */
  snapshot: unknown;
  at: string;
}

export interface PurchaseLedger {
  /** Appends "recorded" or "edited" (no-op when nothing changed or the purchase is voided). */
  record(userId: string, input: PurchaseRecordInput): void;
  /** Appends one "voided" event per not-yet-voided purchase of this item. */
  voidForItem(userId: string, inventoryItemId: string, at: string): number;
  list(userId: string): PurchaseEventRecord[];
  /** purchasedAt of every non-voided purchase. */
  activePurchaseTimes(userId: string): string[];
  /** Every user_id in the ledger, including anonymized deleted accounts. */
  listUserIds(): string[];
  /** Account deletion (H2): every row for this user_id is deleted. Returns rows deleted. */
  deleteUser(userId: string): number;
}

/**
 * Before H2, deleted accounts' rows stayed under a random `deleted_<uuid>` ID. Those buckets are
 * folded into north_star_weekly_totals and deleted when the API starts (see app.ts).
 */
export const ANONYMIZED_USER_PREFIX = "deleted_";

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Pure: which event (if any) a save appends, given the purchase's events so far. */
export function nextPurchaseEvent(
  existing: Array<{ kind: string; purchasedAt: string; snapshot: string | null }>,
  input: { purchasedAt: string; snapshot: string },
): PurchaseEventKind | null {
  if (existing.some((e) => e.kind === "voided")) return null;
  const latest = existing.at(-1);
  if (!latest) return "recorded";
  return latest.purchasedAt === input.purchasedAt && latest.snapshot === input.snapshot ? null : "edited";
}

/** Pure: purchasedAt of each non-voided purchase (latest event wins). */
export function activeTimes(events: Array<{ purchaseId: string; kind: string; purchasedAt: string }>): string[] {
  const latest = new Map<string, string>();
  const voided = new Set<string>();
  for (const e of events) {
    if (e.kind === "voided") voided.add(e.purchaseId);
    else latest.set(e.purchaseId, e.purchasedAt);
  }
  return [...latest].filter(([id]) => !voided.has(id)).map(([, at]) => at);
}

export function createMemoryPurchaseLedger(): PurchaseLedger {
  const rows: Array<PurchaseEventRecord & { userId: string }> = [];
  const append = (userId: string, row: Omit<PurchaseEventRecord, "eventId">) =>
    rows.push({ ...row, userId, eventId: randomUUID() });
  return {
    record(userId, input) {
      const snapshot = stableJson(input.snapshot);
      const kind = nextPurchaseEvent(rows.filter((r) => r.purchaseId === input.purchaseId), { purchasedAt: input.purchasedAt, snapshot });
      if (kind) append(userId, { purchaseId: input.purchaseId, inventoryItemId: input.inventoryItemId, kind, purchasedAt: input.purchasedAt, snapshot, at: input.at });
    },
    voidForItem(userId, inventoryItemId, at) {
      const mine = rows.filter((r) => r.userId === userId && r.inventoryItemId === inventoryItemId);
      let count = 0;
      for (const purchaseId of new Set(mine.map((r) => r.purchaseId))) {
        const events = mine.filter((r) => r.purchaseId === purchaseId);
        if (events.some((e) => e.kind === "voided")) continue;
        append(userId, { purchaseId, inventoryItemId, kind: "voided", purchasedAt: events.at(-1)!.purchasedAt, snapshot: null, at });
        count += 1;
      }
      return count;
    },
    list: (userId) => rows.filter((r) => r.userId === userId).map(({ userId: _u, ...r }) => ({ ...r })),
    activePurchaseTimes: (userId) => activeTimes(rows.filter((r) => r.userId === userId)),
    listUserIds: () => [...new Set(rows.map((r) => r.userId))],
    deleteUser(userId) {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i]!.userId !== userId) continue;
        rows.splice(i, 1);
        count += 1;
      }
      return count;
    },
  };
}

export function createSqlitePurchaseLedger(db: BetterSQLite3Database<typeof schema>): PurchaseLedger {
  const eventsFor = (purchaseId: string) =>
    db.select().from(purchaseEvents).where(eq(purchaseEvents.purchaseId, purchaseId)).orderBy(asc(purchaseEvents.seq)).all();
  const insert = (userId: string, row: Omit<PurchaseEventRecord, "eventId">) =>
    db.insert(purchaseEvents).values({ ...row, userId, eventId: randomUUID() }).run();
  const toRecord = ({ userId: _u, seq: _s, ...row }: typeof purchaseEvents.$inferSelect): PurchaseEventRecord => ({
    ...row,
    kind: row.kind as PurchaseEventKind,
  });
  return {
    record(userId, input) {
      const snapshot = stableJson(input.snapshot);
      const kind = nextPurchaseEvent(eventsFor(input.purchaseId), { purchasedAt: input.purchasedAt, snapshot });
      if (kind) insert(userId, { purchaseId: input.purchaseId, inventoryItemId: input.inventoryItemId, kind, purchasedAt: input.purchasedAt, snapshot, at: input.at });
    },
    voidForItem(userId, inventoryItemId, at) {
      const mine = db
        .select()
        .from(purchaseEvents)
        .where(and(eq(purchaseEvents.userId, userId), eq(purchaseEvents.inventoryItemId, inventoryItemId)))
        .orderBy(asc(purchaseEvents.seq))
        .all();
      let count = 0;
      for (const purchaseId of new Set(mine.map((r) => r.purchaseId))) {
        const events = mine.filter((r) => r.purchaseId === purchaseId);
        if (events.some((e) => e.kind === "voided")) continue;
        insert(userId, { purchaseId, inventoryItemId, kind: "voided", purchasedAt: events.at(-1)!.purchasedAt, snapshot: null, at });
        count += 1;
      }
      return count;
    },
    list: (userId) =>
      db.select().from(purchaseEvents).where(eq(purchaseEvents.userId, userId)).orderBy(asc(purchaseEvents.seq)).all().map(toRecord),
    activePurchaseTimes: (userId) =>
      activeTimes(db.select().from(purchaseEvents).where(eq(purchaseEvents.userId, userId)).orderBy(asc(purchaseEvents.seq)).all()),
    listUserIds: () => db.selectDistinct({ userId: purchaseEvents.userId }).from(purchaseEvents).all().map((r) => r.userId),
    deleteUser: (userId) => db.delete(purchaseEvents).where(eq(purchaseEvents.userId, userId)).run().changes,
  };
}
