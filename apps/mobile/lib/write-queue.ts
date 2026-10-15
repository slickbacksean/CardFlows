import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { File, Paths } from "expo-file-system";
import {
  dueWrites,
  emptyWriteQueue,
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
};

type Results = {
  livestream_purchase: Awaited<ReturnType<typeof saveLivestreamPurchase>>;
  save_purchased: Awaited<ReturnType<typeof savePurchased>>;
  save_watchlist: Awaited<ReturnType<typeof saveWatchlist>>;
  watchlist_to_purchased: Awaited<ReturnType<typeof convertWatchlistToPurchased>>;
  complete_details: Awaited<ReturnType<typeof completePurchasedDetails>>;
};

const EXECUTORS: { [K in QueuedWriteKind]: (payload: Payloads[K], key: string) => Promise<Results[K]> } = {
  livestream_purchase: (p, key) => saveLivestreamPurchase(p, key),
  save_purchased: (p, key) => savePurchased(p, key),
  save_watchlist: (p, key) => saveWatchlist(p, key),
  watchlist_to_purchased: (p) => convertWatchlistToPurchased(p.inventoryItemId),
  complete_details: (p) => completePurchasedDetails(p.inventoryItemId, p.input),
};

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
    for (const item of dueWrites(load())) {
      // Undo may have removed it while an earlier item was in flight.
      if (!load().items.some((i) => i.id === item.id)) continue;
      try {
        await (EXECUTORS[item.kind] as (p: unknown, key: string) => Promise<unknown>)(item.payload, item.id);
        save(removeWrite(load(), item.id));
      } catch (error) {
        const status = apiErrorStatus(error);
        if (shouldRetryWrite(status)) {
          save(markWriteFailed(load(), item.id, String((error as Error)?.message ?? error)));
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

/** Call once at app start: flush now and whenever the app comes to the foreground. */
export function startWriteQueue(): () => void {
  load();
  void flushWriteQueue();
  const sub = AppState.addEventListener("change", (next) => {
    if (next === "active") void flushWriteQueue();
  });
  return () => {
    sub.remove();
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
