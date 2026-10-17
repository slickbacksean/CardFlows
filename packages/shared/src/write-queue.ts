/**
 * P1-09: offline write queue (pure logic; the phone persists it).
 * Each write carries an idempotency key so a retry never makes a second row.
 */
export type QueuedWriteKind =
  | "livestream_purchase"
  | "save_purchased"
  | "save_watchlist"
  | "watchlist_to_purchased"
  | "complete_details"
  | "save_sale"
  | "delete_sale"
  | "import_grade_history";

export interface QueuedWrite<P = unknown> {
  /** Also the Idempotency-Key header. */
  id: string;
  kind: QueuedWriteKind;
  payload: P;
  createdAt: string;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
}

export interface WriteQueueState {
  version: 1;
  items: QueuedWrite[];
}

export const WRITE_QUEUE_BASE_DELAY_MS = 2_000;
export const WRITE_QUEUE_MAX_DELAY_MS = 5 * 60_000;
export const WRITE_QUEUE_MAX_ITEMS = 500;

export function emptyWriteQueue(): WriteQueueState {
  return { version: 1, items: [] };
}

export function enqueueWrite<P>(
  state: WriteQueueState,
  input: { id: string; kind: QueuedWriteKind; payload: P },
  now = Date.now(),
): WriteQueueState {
  if (state.items.some((item) => item.id === input.id)) return state;
  const item: QueuedWrite<P> = {
    id: input.id,
    kind: input.kind,
    payload: input.payload,
    createdAt: new Date(now).toISOString(),
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
  };
  return { version: 1, items: [...state.items, item].slice(-WRITE_QUEUE_MAX_ITEMS) };
}

export function removeWrite(state: WriteQueueState, id: string): WriteQueueState {
  return { version: 1, items: state.items.filter((item) => item.id !== id) };
}

/** Exponential backoff with a cap: 2s, 4s, 8s … 5 min. */
export function writeRetryDelayMs(attempts: number): number {
  return Math.min(WRITE_QUEUE_MAX_DELAY_MS, WRITE_QUEUE_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
}

export function markWriteFailed(state: WriteQueueState, id: string, error: string, now = Date.now()): WriteQueueState {
  return {
    version: 1,
    items: state.items.map((item) =>
      item.id === id
        ? { ...item, attempts: item.attempts + 1, lastError: error, nextAttemptAt: now + writeRetryDelayMs(item.attempts + 1) }
        : item,
    ),
  };
}

/** Oldest first, so writes replay in the order they were made. */
export function dueWrites(state: WriteQueueState, now = Date.now()): QueuedWrite[] {
  return state.items.filter((item) => item.nextAttemptAt <= now);
}

/**
 * The card a write belongs to. Writes for one card must replay in order (e.g. save sale, then
 * delete sale); writes for different cards are independent.
 */
export function writeEntityKey(item: Pick<QueuedWrite, "id" | "payload">): string {
  const payload = (item.payload ?? {}) as { inventoryItemId?: unknown; confirmationId?: unknown };
  if (typeof payload.inventoryItemId === "string" && payload.inventoryItemId) return `item:${payload.inventoryItemId}`;
  if (typeof payload.confirmationId === "string" && payload.confirmationId) return `confirmation:${payload.confirmationId}`;
  return `write:${item.id}`;
}

/**
 * Oldest first, keeping per-card order: a write that is not due yet (backing off after a 5xx)
 * holds back every later write for the same card instead of letting it skip ahead.
 */
export function orderedRunnableWrites(state: WriteQueueState, now = Date.now()): QueuedWrite[] {
  const held = new Set<string>();
  const runnable: QueuedWrite[] = [];
  for (const item of state.items) {
    const key = writeEntityKey(item);
    if (held.has(key)) continue;
    if (item.nextAttemptAt > now) {
      held.add(key);
      continue;
    }
    runnable.push(item);
  }
  return runnable;
}

/** Back online: every write may try again now (the backoff was for the outage). */
export function makeWritesDue(state: WriteQueueState, now = Date.now()): WriteQueueState {
  return { version: 1, items: state.items.map((item) => ({ ...item, nextAttemptAt: Math.min(item.nextAttemptAt, now) })) };
}

/**
 * Whether a failed attempt should stay queued. No status = network/timeout; 408/429/5xx = transient.
 * Other 4xx mean the server answered and will keep refusing, so the write is dropped.
 */
export function shouldRetryWrite(status: number | null | undefined): boolean {
  if (status == null) return true;
  return status === 408 || status === 429 || status >= 500;
}

export function writeQueueLabel(count: number): string | null {
  if (count <= 0) return null;
  return `${count} waiting to sync`;
}

export function parseWriteQueue(raw: string | null | undefined): WriteQueueState {
  if (!raw) return emptyWriteQueue();
  try {
    const value = JSON.parse(raw) as Partial<WriteQueueState>;
    if (value?.version !== 1 || !Array.isArray(value.items)) return emptyWriteQueue();
    return value as WriteQueueState;
  } catch {
    return emptyWriteQueue();
  }
}
