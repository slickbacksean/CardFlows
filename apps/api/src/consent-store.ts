import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { CARDSIGHT_CONSENT_VERSION, type CardSightConsentState } from "@cardflow/shared";
import { providerConsents, schema } from "./db/schema";

export type ConsentProvider = "cardsight";

export interface ConsentRecord {
  version: string;
  grantedAt: string;
  withdrawnAt: string | null;
  updatedAt: string;
}

/** Sean: provider consent with its version and timestamps, kept on the server. */
export interface ConsentStore {
  get(userId: string, provider: ConsentProvider): ConsentRecord | null;
  /** Agree to `version` (clears any withdrawal). */
  grant(userId: string, provider: ConsentProvider, version: string, at: string): ConsentRecord;
  /** Withdraw: keeps the version and grant time for the record. */
  withdraw(userId: string, provider: ConsentProvider, at: string): ConsentRecord | null;
  deleteUser(userId: string): number;
}

/** A declined prompt is stored as an already-withdrawn row so the app doesn't ask again for this version. */
export function consentState(record: ConsentRecord | null): CardSightConsentState {
  const version = record?.version ?? null;
  const live = Boolean(record && !record.withdrawnAt);
  return {
    granted: live && version === CARDSIGHT_CONSENT_VERSION,
    version,
    grantedAt: live ? record!.grantedAt : null,
    withdrawnAt: record?.withdrawnAt ?? null,
    currentVersion: CARDSIGHT_CONSENT_VERSION,
    needsPrompt: !record || version !== CARDSIGHT_CONSENT_VERSION,
  };
}

/** The server checks this right before calling the CardSight adapter. */
export function hasActiveConsent(store: ConsentStore, userId: string, provider: ConsentProvider = "cardsight"): boolean {
  return consentState(store.get(userId, provider)).granted;
}

export function createMemoryConsentStore(): ConsentStore {
  const rows = new Map<string, ConsentRecord & { userId: string }>();
  const k = (userId: string, provider: ConsentProvider) => `${userId}\0${provider}`;
  const get = (userId: string, provider: ConsentProvider): ConsentRecord | null => {
    const row = rows.get(k(userId, provider));
    return row ? { version: row.version, grantedAt: row.grantedAt, withdrawnAt: row.withdrawnAt, updatedAt: row.updatedAt } : null;
  };
  return {
    get,
    grant(userId, provider, version, at) {
      rows.set(k(userId, provider), { userId, version, grantedAt: at, withdrawnAt: null, updatedAt: at });
      return get(userId, provider)!;
    },
    withdraw(userId, provider, at) {
      const row = rows.get(k(userId, provider));
      if (row) rows.set(k(userId, provider), { ...row, withdrawnAt: row.withdrawnAt ?? at, updatedAt: at });
      return get(userId, provider);
    },
    deleteUser(userId) {
      let n = 0;
      for (const [key, row] of rows) if (row.userId === userId && rows.delete(key)) n += 1;
      return n;
    },
  };
}

export function createSqliteConsentStore(db: BetterSQLite3Database<typeof schema>): ConsentStore {
  const where = (userId: string, provider: ConsentProvider) =>
    and(eq(providerConsents.userId, userId), eq(providerConsents.provider, provider));
  const get = (userId: string, provider: ConsentProvider): ConsentRecord | null => {
    const row = db.select().from(providerConsents).where(where(userId, provider)).get();
    return row ? { version: row.version, grantedAt: row.grantedAt, withdrawnAt: row.withdrawnAt ?? null, updatedAt: row.updatedAt } : null;
  };
  return {
    get,
    grant(userId, provider, version, at) {
      db.insert(providerConsents)
        .values({ userId, provider, version, grantedAt: at, withdrawnAt: null, updatedAt: at })
        .onConflictDoUpdate({
          target: [providerConsents.userId, providerConsents.provider],
          set: { version, grantedAt: at, withdrawnAt: null, updatedAt: at },
        })
        .run();
      return get(userId, provider)!;
    },
    withdraw(userId, provider, at) {
      const current = get(userId, provider);
      if (current) {
        db.update(providerConsents)
          .set({ withdrawnAt: current.withdrawnAt ?? at, updatedAt: at })
          .where(where(userId, provider))
          .run();
      }
      return get(userId, provider);
    },
    deleteUser(userId) {
      return db.delete(providerConsents).where(eq(providerConsents.userId, userId)).run().changes;
    },
  };
}
