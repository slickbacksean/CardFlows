import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { CARDSIGHT_CONSENT_VERSION, type CardSightConsentState } from "@cardflow/shared";
import { cardsightUserUsage, consentEvents, providerConsents, schema } from "./db/schema";

export type ConsentProvider = "cardsight";
export type ConsentEventKind = "grant" | "decline" | "withdraw";

/** Current answer. Backend review M4: a decline is `declinedAt`, never a grant that was withdrawn. */
export interface ConsentRecord {
  version: string;
  grantedAt: string | null;
  declinedAt: string | null;
  withdrawnAt: string | null;
  updatedAt: string;
}

export interface ConsentEvent {
  eventId: string;
  provider: ConsentProvider;
  kind: ConsentEventKind;
  version: string;
  at: string;
}

/**
 * Sean: provider consent with its version and timestamps, kept on the server. Every change also
 * appends one row to the append-only event history (never updated or rewritten).
 */
export interface ConsentStore {
  get(userId: string, provider: ConsentProvider): ConsentRecord | null;
  /** Agree to `version` (clears any decline or withdrawal). */
  grant(userId: string, provider: ConsentProvider, version: string, at: string): ConsentRecord;
  /** Said no to `version` without ever agreeing to it. */
  decline(userId: string, provider: ConsentProvider, version: string, at: string): ConsentRecord;
  /** Withdraw a live grant. No-op (no event) when nothing is granted. */
  withdraw(userId: string, provider: ConsentProvider, at: string): ConsentRecord | null;
  /** History, oldest first. */
  events(userId: string, provider?: ConsentProvider): ConsentEvent[];
  /** Backend review M5: take one CardSight call from this user's month; false once `cap` is used. */
  takeMonthlyUse(userId: string, monthKey: string, cap: number): boolean;
  monthlyUse(userId: string, monthKey: string): number;
  deleteUser(userId: string): number;
}

export function consentState(record: ConsentRecord | null): CardSightConsentState {
  const version = record?.version ?? null;
  const live = Boolean(record?.grantedAt && !record.withdrawnAt && !record.declinedAt);
  return {
    granted: live && version === CARDSIGHT_CONSENT_VERSION,
    version,
    grantedAt: live ? record!.grantedAt : null,
    declinedAt: record?.declinedAt ?? null,
    withdrawnAt: record?.withdrawnAt ?? null,
    currentVersion: CARDSIGHT_CONSENT_VERSION,
    needsPrompt: !record || version !== CARDSIGHT_CONSENT_VERSION,
  };
}

/** The server checks this right before calling the CardSight adapter. */
export function hasActiveConsent(store: ConsentStore, userId: string, provider: ConsentProvider = "cardsight"): boolean {
  return consentState(store.get(userId, provider)).granted;
}

export function cardSightMonthKey(at: Date): string {
  return at.toISOString().slice(0, 7);
}

export function createMemoryConsentStore(): ConsentStore {
  const rows = new Map<string, ConsentRecord & { userId: string }>();
  const history: Array<ConsentEvent & { userId: string }> = [];
  const usage = new Map<string, { userId: string; used: number }>();
  const k = (userId: string, provider: string) => `${userId}\0${provider}`;
  const get = (userId: string, provider: ConsentProvider): ConsentRecord | null => {
    const row = rows.get(k(userId, provider));
    if (!row) return null;
    const { userId: _u, ...record } = row;
    return { ...record };
  };
  const put = (userId: string, provider: ConsentProvider, record: ConsentRecord, kind: ConsentEventKind) => {
    rows.set(k(userId, provider), { userId, ...record });
    history.push({ userId, eventId: randomUUID(), provider, kind, version: record.version, at: record.updatedAt });
    return get(userId, provider)!;
  };
  return {
    get,
    grant: (userId, provider, version, at) =>
      put(userId, provider, { version, grantedAt: at, declinedAt: null, withdrawnAt: null, updatedAt: at }, "grant"),
    decline: (userId, provider, version, at) =>
      put(userId, provider, { version, grantedAt: null, declinedAt: at, withdrawnAt: null, updatedAt: at }, "decline"),
    withdraw(userId, provider, at) {
      const row = get(userId, provider);
      if (!row?.grantedAt || row.withdrawnAt || row.declinedAt) return row;
      return put(userId, provider, { ...row, withdrawnAt: at, updatedAt: at }, "withdraw");
    },
    events: (userId, provider) =>
      history.filter((e) => e.userId === userId && (!provider || e.provider === provider)).map(({ userId: _u, ...e }) => ({ ...e })),
    takeMonthlyUse(userId, monthKey, cap) {
      const row = usage.get(k(userId, monthKey)) ?? { userId, used: 0 };
      if (row.used >= cap) return false;
      usage.set(k(userId, monthKey), { userId, used: row.used + 1 });
      return true;
    },
    monthlyUse: (userId, monthKey) => usage.get(k(userId, monthKey))?.used ?? 0,
    deleteUser(userId) {
      let n = 0;
      for (const [key, row] of rows) if (row.userId === userId && rows.delete(key)) n += 1;
      for (let i = history.length - 1; i >= 0; i -= 1) if (history[i]!.userId === userId) history.splice(i, 1);
      for (const [key, row] of usage) if (row.userId === userId) usage.delete(key);
      return n;
    },
    /** Memory-store only. Not used at sign-up any more (guests never get CardSight). */
    moveUser(fromUserId: string, toUserId: string) {
      const guest = get(fromUserId, "cardsight");
      if (guest && !get(toUserId, "cardsight")) rows.set(k(toUserId, "cardsight"), { userId: toUserId, ...guest });
      for (const e of history) if (e.userId === fromUserId) e.userId = toUserId;
      for (const [key, row] of [...usage]) {
        if (row.userId !== fromUserId) continue;
        const month = key.split("\0")[1]!;
        if (!usage.has(k(toUserId, month))) usage.set(k(toUserId, month), { userId: toUserId, used: row.used });
      }
      this.deleteUser(fromUserId);
    },
  } as ConsentStore & { moveUser(fromUserId: string, toUserId: string): void };
}

export function createSqliteConsentStore(db: BetterSQLite3Database<typeof schema>): ConsentStore {
  const where = (userId: string, provider: ConsentProvider) =>
    and(eq(providerConsents.userId, userId), eq(providerConsents.provider, provider));
  const get = (userId: string, provider: ConsentProvider): ConsentRecord | null => {
    const row = db.select().from(providerConsents).where(where(userId, provider)).get();
    return row
      ? {
          version: row.version,
          grantedAt: row.grantedAt ?? null,
          declinedAt: row.declinedAt ?? null,
          withdrawnAt: row.withdrawnAt ?? null,
          updatedAt: row.updatedAt,
        }
      : null;
  };
  const put = (userId: string, provider: ConsentProvider, record: ConsentRecord, kind: ConsentEventKind) =>
    db.transaction((tx) => {
      tx.insert(providerConsents)
        .values({ userId, provider, ...record })
        .onConflictDoUpdate({ target: [providerConsents.userId, providerConsents.provider], set: { ...record } })
        .run();
      tx.insert(consentEvents)
        .values({ eventId: randomUUID(), userId, provider, kind, version: record.version, at: record.updatedAt })
        .run();
      return get(userId, provider)!;
    });
  return {
    get,
    grant: (userId, provider, version, at) =>
      put(userId, provider, { version, grantedAt: at, declinedAt: null, withdrawnAt: null, updatedAt: at }, "grant"),
    decline: (userId, provider, version, at) =>
      put(userId, provider, { version, grantedAt: null, declinedAt: at, withdrawnAt: null, updatedAt: at }, "decline"),
    withdraw(userId, provider, at) {
      const row = get(userId, provider);
      if (!row?.grantedAt || row.withdrawnAt || row.declinedAt) return row;
      return put(userId, provider, { ...row, withdrawnAt: at, updatedAt: at }, "withdraw");
    },
    events(userId, provider) {
      const cond = provider
        ? and(eq(consentEvents.userId, userId), eq(consentEvents.provider, provider))
        : eq(consentEvents.userId, userId);
      return db
        .select()
        .from(consentEvents)
        .where(cond)
        .orderBy(asc(consentEvents.seq))
        .all()
        .map((e) => ({ eventId: e.eventId, provider: e.provider, kind: e.kind, version: e.version, at: e.at }));
    },
    takeMonthlyUse(userId, monthKey, cap) {
      // One statement: the insert/increment happens only while under the cap.
      if (cap <= 0) return false;
      const res = db
        .insert(cardsightUserUsage)
        .values({ userId, monthKey, used: 1 })
        .onConflictDoUpdate({
          target: [cardsightUserUsage.userId, cardsightUserUsage.monthKey],
          set: { used: sql`${cardsightUserUsage.used} + 1` },
          setWhere: sql`${cardsightUserUsage.used} < ${cap}`,
        })
        .run();
      return res.changes > 0;
    },
    monthlyUse(userId, monthKey) {
      const row = db
        .select({ used: cardsightUserUsage.used })
        .from(cardsightUserUsage)
        .where(and(eq(cardsightUserUsage.userId, userId), eq(cardsightUserUsage.monthKey, monthKey)))
        .get();
      return row?.used ?? 0;
    },
    deleteUser(userId) {
      return db.transaction((tx) => {
        tx.delete(consentEvents).where(eq(consentEvents.userId, userId)).run();
        tx.delete(cardsightUserUsage).where(eq(cardsightUserUsage.userId, userId)).run();
        return tx.delete(providerConsents).where(eq(providerConsents.userId, userId)).run().changes;
      });
    },
  };
}
