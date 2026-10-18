import type { AccountStore, PokecollectorPendingDeletion } from "./account-store";
import type { PokecollectorAccounts, PokecollectorRemoteDeletion, PokecollectorUserMapping } from "./pokecollector-accounts";
import { createPokecollectorPacer, type PokecollectorPacer } from "./pokecollector-pacer";

/**
 * Backend re-review H1/M1 (P4): PokéCollector deletes after an account delete run here, in the
 * background, never on the request path. Rows live in pokecollector_pending_deletions (remote ID
 * only), written in the same transaction as the account's rows, so a crash or restart never
 * loses one. A failed attempt is retried with backoff (1 min, 5 min, 30 min, 2 h, 6 h, 12 h,
 * then daily), so a PokéCollector outage of a few days still ends with the user deleted. Calls
 * are paced well under PokéCollector's per-IP limits (pokecollector-pacer.ts).
 *
 * "hold" rows (shared, guest or legacy remote users) are never deleted here: other CardFlow
 * users' cards may be on them. The opaque-accounts relink script freezes them.
 */
export const POKECOLLECTOR_DELETION_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
  24 * 3_600_000,
] as const;
/**
 * Backend final review R3: after this many failed attempts (about 9 days with the backoff above) a
 * row is marked "failed", the queue stops trying, and ops gets an alert.
 */
export const POKECOLLECTOR_DELETION_MAX_ATTEMPTS = 14;
/** A "delete" row older than this counts as stuck in /ops/pokecollector-deletions. */
export const POKECOLLECTOR_DELETION_STUCK_AFTER_MS = 3 * 86_400_000;
/** Rows handled per run; the rest wait for the next tick. */
export const POKECOLLECTOR_DELETIONS_PER_RUN = 10;

export function nextPokecollectorDeletionAttempt(attempts: number, now: Date): string {
  const delays = POKECOLLECTOR_DELETION_BACKOFF_MS;
  const delay = delays[Math.min(Math.max(attempts, 1), delays.length) - 1]!;
  return new Date(now.getTime() + delay).toISOString();
}

export interface PokecollectorDeletionRun {
  deleted: number;
  retrying: number;
  held: number;
  failed: number;
}

export interface PokecollectorDeletionQueue {
  /**
   * Remembers the deleted user's link in memory (never stored), so the run can fall back to
   * deleting items as that user if the admin delete is refused. Lost on restart: then only the
   * admin delete is tried.
   */
  remember(mapping: PokecollectorUserMapping): void;
  /** Starts a run soon, without waiting (the delete route calls this). */
  kick(): void;
  /** One run over the due rows (single flight: a second call joins the first). */
  run(): Promise<PokecollectorDeletionRun>;
}

export function createPokecollectorDeletionQueue(options: {
  accounts: AccountStore;
  pokecollector: () => PokecollectorAccounts;
  /** CardFlow users still linked to this remote user (a row is held while any are). */
  linksTo: (remoteUserId: string) => number;
  now?: () => Date;
  pacer?: PokecollectorPacer;
  perRun?: number;
  maxAttempts?: number;
  /** Called once when a row is marked "failed" (ops alert and log; no CardFlow user data in it). */
  onGaveUp?: (row: { remoteUserId: string; attempts: number; lastResult: string }) => void;
}): PokecollectorDeletionQueue {
  const now = options.now ?? (() => new Date());
  const pacer = options.pacer ?? createPokecollectorPacer();
  const mappings = new Map<string, PokecollectorUserMapping>();
  let running: Promise<PokecollectorDeletionRun> | null = null;

  const finished = (result: PokecollectorRemoteDeletion) => result === "user_deleted" || result === "cards_deleted";

  async function attempt(row: PokecollectorPendingDeletion, result: PokecollectorDeletionRun): Promise<void> {
    if (options.linksTo(row.remoteUserId) > 0) {
      // Someone was linked to it since: never delete a remote user another CardFlow user uses.
      options.accounts.updatePokecollectorDeletion(row.remoteUserId, { mode: "hold", lastResult: "shared" });
      result.held += 1;
      return;
    }
    const pokecollector = options.pokecollector();
    if (pokecollector.name === "off") {
      // Accounts are off: try again later, without counting an attempt.
      options.accounts.updatePokecollectorDeletion(row.remoteUserId, {
        nextAttemptAt: nextPokecollectorDeletionAttempt(POKECOLLECTOR_DELETION_BACKOFF_MS.length, now()),
        lastResult: "accounts_off",
      });
      result.retrying += 1;
      return;
    }
    let outcome: PokecollectorRemoteDeletion;
    try {
      outcome = await pokecollector.deleteRemoteUser(
        { pokecollectorUserId: row.remoteUserId, mapping: mappings.get(row.remoteUserId) ?? null },
        { pacer },
      );
    } catch {
      outcome = "failed";
    }
    if (finished(outcome)) {
      options.accounts.removePokecollectorDeletion(row.remoteUserId);
      mappings.delete(row.remoteUserId);
      result.deleted += 1;
      return;
    }
    const attempts = row.attempts + 1;
    if (attempts >= (options.maxAttempts ?? POKECOLLECTOR_DELETION_MAX_ATTEMPTS)) {
      options.accounts.updatePokecollectorDeletion(row.remoteUserId, { mode: "failed", attempts, lastResult: outcome });
      result.failed += 1;
      try {
        options.onGaveUp?.({ remoteUserId: row.remoteUserId, attempts, lastResult: outcome });
      } catch {
        // An alert sink must never break the queue.
      }
      return;
    }
    options.accounts.updatePokecollectorDeletion(row.remoteUserId, {
      attempts,
      nextAttemptAt: nextPokecollectorDeletionAttempt(attempts, now()),
      lastResult: outcome,
    });
    result.retrying += 1;
  }

  async function runOnce(): Promise<PokecollectorDeletionRun> {
    const result: PokecollectorDeletionRun = { deleted: 0, retrying: 0, held: 0, failed: 0 };
    const due = options.accounts.listDuePokecollectorDeletions(now().toISOString(), options.perRun ?? POKECOLLECTOR_DELETIONS_PER_RUN);
    for (const row of due) await attempt(row, result);
    return result;
  }

  const queue: PokecollectorDeletionQueue = {
    remember(mapping) {
      mappings.set(mapping.pokecollectorUserId, mapping);
    },
    kick() {
      setTimeout(() => {
        queue.run().catch(() => undefined);
      }, 0).unref?.();
    },
    run() {
      if (!running) {
        running = runOnce().finally(() => {
          running = null;
        });
      }
      return running;
    },
  };
  return queue;
}

export interface PokecollectorDeletionCounts {
  pending: number;
  held: number;
  failed: number;
  /** "delete" rows older than POKECOLLECTOR_DELETION_STUCK_AFTER_MS. */
  stuck: number;
  oldestPendingAt: string | null;
  maxAttempts: number;
}

/** R3: counts only (no remote or CardFlow IDs) for /ops/pokecollector-deletions. */
export function pokecollectorDeletionCounts(rows: readonly PokecollectorPendingDeletion[], now: Date): PokecollectorDeletionCounts {
  const pending = rows.filter((r) => r.mode === "delete");
  const stuckBefore = now.getTime() - POKECOLLECTOR_DELETION_STUCK_AFTER_MS;
  return {
    pending: pending.length,
    held: rows.filter((r) => r.mode === "hold").length,
    failed: rows.filter((r) => r.mode === "failed").length,
    stuck: pending.filter((r) => Date.parse(r.createdAt) < stuckBefore).length,
    oldestPendingAt: pending.map((r) => r.createdAt).sort()[0] ?? null,
    maxAttempts: POKECOLLECTOR_DELETION_MAX_ATTEMPTS,
  };
}
