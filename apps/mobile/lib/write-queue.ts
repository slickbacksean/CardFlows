import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { File, Paths } from "expo-file-system";
import {
  emptyWriteQueue,
  makeWritesDue,
  orderedRunnableWrites,
  writeEntityKey,
  enqueueWrite,
  markWriteFailed,
  parseWriteQueue,
  removeWrite,
  shouldRetryWrite,
  type QueuedWriteKind,
  type WriteQueueState,
} from "@cardflow/shared";
import {
  apiErrorStatus,
  completePurchasedDetails,
  convertWatchlistToPurchased,
  deleteSaleRemote,
  saveSaleRemote,
  importGradeHistory,
  saveLivestreamPurchase,
  savePurchased,
  saveWatchlist,
} from "./api";
import { createRequestId } from "./request-id";

/**
 * P1-09: Purchased, Watchlist and details writes that fail because the phone is offline are kept
 * in a file-backed queue and replayed (with backoff) while the app is open. Each write keeps one
 * idempotency key for every attempt, so the server makes exactly one row.
 */
type Payloads = {
  livestream_purchase: Parameters<typeof saveLivestreamPurchase>[0];
  save_purchased: Parameters<typeof savePurchased>[0];
  save_watchlist: Parameters<typeof saveWatchlist>[0];
  watchlist_to_purchased: { inventoryItemId: string };
  complete_details: { inventoryItemId: string; input: Parameters<typeof completePurchasedDetails>[1] };
  save_sale: { inventoryItemId: string; body: Parameters<typeof saveSaleRemote>[1] };
  delete_sale: { inventoryItemId: string };
  import_grade_history: { inventoryItemId: string; entries: Parameters<typeof importGradeHistory>[1] };
};

type Results = {
  livestream_purchase: Awaited<ReturnType<typeof saveLivestreamPurchase>>;
  save_purchased: Awaited<ReturnType<typeof savePurchased>>;
  save_watchlist: Awaited<ReturnType<typeof saveWatchlist>>;
  watchlist_to_purchased: Awaited<ReturnType<typeof convertWatchlistToPurchased>>;
  complete_details: Awaited<ReturnType<typeof completePurchasedDetails>>;
  save_sale: Awaited<ReturnType<typeof saveSaleRemote>>;
  delete_sale: Awaited<ReturnType<typeof deleteSaleRemote>>;
  import_grade_history: Awaited<ReturnType<typeof importGradeHistory>>;
};

const EXECUTORS: { [K in QueuedWriteKind]: (payload: Payloads[K], key: string) => Promise<Results[K]> } = {
  livestream_purchase: (p, key) => saveLivestreamPurchase(p, key),
  save_purchased: (p, key) => savePurchased(p, key),
  save_watchlist: (p, key) => saveWatchlist(p, key),
  // Mobile Tech Lead review: every kind sends its queue ID as the Idempotency-Key.
  watchlist_to_purchased: (p, key) => convertWatchlistToPurchased(p.inventoryItemId, key),
  complete_details: (p, key) => completePurchasedDetails(p.inventoryItemId, p.input, key),
  save_sale: (p, key) => saveSaleRemote(p.inventoryItemId, p.body, key),
  delete_sale: (p, key) => deleteSaleRemote(p.inventoryItemId, key),
  import_grade_history: (p, key) => importGradeHistory(p.inventoryItemId, p.entries, key),
};

/** Writes of one kind still waiting on the phone, oldest first (for optimistic overlays). */
export function pendingWritesOf<K extends QueuedWriteKind>(kind: K): Payloads[K][] {
  return load()
    .items.filter((item) => item.kind === kind)
    .map((item) => item.payload as Payloads[K]);
}

/** Every pending write as kind + payload, oldest first. */
export function pendingWrites(): Array<{ kind: QueuedWriteKind; payload: unknown }> {
  return load().items.map((item) => ({ kind: item.kind, payload: item.payload }));
}

export const QUEUED_ID_PREFIX = "queued:" as const;
const FILE_NAME = "write-queue-v1.json";
let state: WriteQueueState | null = null;
const listeners = new Set<() => void>();
let flushing = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function queueFile() {
  return new File(Paths.document, FILE_NAME);
}

function load(): WriteQueueState {
  if (state) return state;
  try {
    const file = queueFile();
    state = file.exists ? parseWriteQueue(file.textSync()) : emptyWriteQueue();
  } catch {
    state = emptyWriteQueue();
  }
  return state;
}

function save(next: WriteQueueState) {
  state = next;
  try {
    queueFile().write(JSON.stringify(next));
  } catch {
    // Keep going in memory; the next successful write persists everything.
  }
  for (const listener of listeners) listener();
  schedule();
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = null;
  const items = load().items;
  if (items.length === 0) return;
  const wait = Math.max(1_000, Math.min(...items.map((i) => i.nextAttemptAt)) - Date.now());
  timer = setTimeout(() => void flushWriteQueue(), wait);
}

/** P4 account deletion: drop every pending write (they belong to the deleted account). */
export function clearWriteQueue(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  state = emptyWriteQueue();
  try {
    const file = queueFile();
    if (file.exists) file.delete();
  } catch {
    // Nothing on disk.
  }
  for (const listener of listeners) listener();
}

export type QueueableResult<T> = { queued: false; result: T } | { queued: true; queuedId: string };

/**
 * Runs a write now. If the server can't be reached (or answers 5xx/429), the write is queued
 * and `{ queued: true }` is returned so the UI can continue as if it worked.
 */
export async function runQueueableWrite<K extends QueuedWriteKind>(
  kind: K,
  payload: Payloads[K],
): Promise<QueueableResult<Results[K]>> {
  const id = createRequestId();
  try {
    const result = await (EXECUTORS[kind] as (p: Payloads[K], key: string) => Promise<Results[K]>)(payload, id);
    return { queued: false, result };
  } catch (error) {
    if (!shouldRetryWrite(apiErrorStatus(error))) throw error;
    save(markWriteFailed(enqueueWrite(load(), { id, kind, payload }), id, String((error as Error)?.message ?? error)));
    return { queued: true, queuedId: `${QUEUED_ID_PREFIX}${id}` };
  }
}

/** Undo for a write that never left the phone: drop it from the queue. */
export function cancelQueuedWrite(queuedId: string): boolean {
  const id = queuedId.startsWith(QUEUED_ID_PREFIX) ? queuedId.slice(QUEUED_ID_PREFIX.length) : queuedId;
  const before = load().items.length;
  save(removeWrite(load(), id));
  return load().items.length < before;
}

export function isQueuedId(id: string | null | undefined): boolean {
  return Boolean(id?.startsWith(QUEUED_ID_PREFIX));
}

export async function flushWriteQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    // Mobile Tech Lead review: per-card order. A write that failed (5xx) or is backing off holds
    // back every later write for the same card, so they never run out of order.
    const blocked = new Set<string>();
    for (const item of orderedRunnableWrites(load())) {
      // Undo may have removed it while an earlier item was in flight.
      if (!load().items.some((i) => i.id === item.id)) continue;
      const entity = writeEntityKey(item);
      if (blocked.has(entity)) continue;
      try {
        await (EXECUTORS[item.kind] as (p: unknown, key: string) => Promise<unknown>)(item.payload, item.id);
        save(removeWrite(load(), item.id));
      } catch (error) {
        const status = apiErrorStatus(error);
        if (shouldRetryWrite(status)) {
          save(markWriteFailed(load(), item.id, String((error as Error)?.message ?? error)));
          blocked.add(entity);
          if (status == null) break; // Still offline: stop and wait for the next attempt.
        } else {
          save(removeWrite(load(), item.id)); // Server refused for good (e.g. 409 already done).
        }
      }
    }
  } finally {
    flushing = false;
    schedule();
  }
}

/** Call once at app start: flush now, on foreground, and as soon as the network comes back. */
export function startWriteQueue(): () => void {
  load();
  void flushWriteQueue();
  const sub = AppState.addEventListener("change", (next) => {
    if (next === "active") void flushWriteQueue();
  });
  let wasOnline: boolean | null = null;
  const unsubscribeNet = NetInfo.addEventListener((net) => {
    const online = Boolean(net.isConnected) && net.isInternetReachable !== false;
    if (online && wasOnline === false) {
      save(makeWritesDue(load()));
      void flushWriteQueue();
    }
    wasOnline = online;
  });
  return () => {
    sub.remove();
    unsubscribeNet();
    if (timer) clearTimeout(timer);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWriteQueueCount(): number {
  return useSyncExternalStore(subscribe, () => load().items.length, () => 0);
}
