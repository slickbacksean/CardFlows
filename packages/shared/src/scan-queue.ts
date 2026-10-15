/**
 * P1-10: offline scan queue (pure logic; the phone persists it). Scans taken offline are kept
 * as downscaled, metadata-free stills and uploaded when the phone is back online. Each scan
 * keeps one idempotency key for every attempt, so a replay never makes a second scan.
 */
export type QueuedScanStatus = "pending" | "ready";

export interface QueuedScan {
  /** Also the Idempotency-Key header. */
  id: string;
  /** Local file inside the app's document directory. Deleted once uploaded. */
  fileUri: string | null;
  mimeType: string;
  captureMethod: "camera_photo" | "manual_scan";
  capturedAt: string;
  status: QueuedScanStatus;
  attempts: number;
  nextAttemptAt: number;
  scanId: string | null;
}

export interface ScanQueueState {
  version: 1;
  items: QueuedScan[];
}

export const SCAN_QUEUE_MAX_ITEMS = 50;
/** Queued stills follow the scan-photo retention rule. */
export const SCAN_QUEUE_RETENTION_DAYS = 30;
export const SCAN_QUEUE_BASE_DELAY_MS = 3_000;
export const SCAN_QUEUE_MAX_DELAY_MS = 5 * 60_000;

export function emptyScanQueue(): ScanQueueState {
  return { version: 1, items: [] };
}

export function parseScanQueue(raw: string | null | undefined): ScanQueueState {
  try {
    const parsed = JSON.parse(raw ?? "") as Partial<ScanQueueState>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.items)) return emptyScanQueue();
    return { version: 1, items: parsed.items.filter((i): i is QueuedScan => typeof i?.id === "string") };
  } catch {
    return emptyScanQueue();
  }
}

export function canQueueScan(state: ScanQueueState): boolean {
  return state.items.filter((i) => i.status === "pending").length < SCAN_QUEUE_MAX_ITEMS;
}

export function enqueueScan(
  state: ScanQueueState,
  input: { id: string; fileUri: string; mimeType: string; captureMethod: QueuedScan["captureMethod"] },
  now = Date.now(),
): ScanQueueState {
  if (state.items.some((i) => i.id === input.id) || !canQueueScan(state)) return state;
  return {
    version: 1,
    items: [
      ...state.items,
      { ...input, capturedAt: new Date(now).toISOString(), status: "pending", attempts: 0, nextAttemptAt: now, scanId: null },
    ],
  };
}

export function scanRetryDelayMs(attempts: number): number {
  return Math.min(SCAN_QUEUE_MAX_DELAY_MS, SCAN_QUEUE_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
}

export function markScanFailed(state: ScanQueueState, id: string, now = Date.now()): ScanQueueState {
  return {
    version: 1,
    items: state.items.map((i) =>
      i.id === id ? { ...i, attempts: i.attempts + 1, nextAttemptAt: now + scanRetryDelayMs(i.attempts + 1) } : i,
    ),
  };
}

/** Uploaded: keep the scan ID for "Ready to confirm", drop the local file. */
export function markScanReady(state: ScanQueueState, id: string, scanId: string): ScanQueueState {
  return {
    version: 1,
    items: state.items.map((i) => (i.id === id ? { ...i, status: "ready", scanId, fileUri: null } : i)),
  };
}

export function removeQueuedScan(state: ScanQueueState, id: string): ScanQueueState {
  return { version: 1, items: state.items.filter((i) => i.id !== id) };
}

export function dueScans(state: ScanQueueState, now = Date.now()): QueuedScan[] {
  return state.items.filter((i) => i.status === "pending" && i.nextAttemptAt <= now);
}

export function readyToConfirm(state: ScanQueueState): QueuedScan[] {
  return state.items.filter((i) => i.status === "ready" && i.scanId);
}

/** Items past retention; the caller deletes their files. */
export function expiredScans(state: ScanQueueState, now = Date.now()): QueuedScan[] {
  const cutoff = now - SCAN_QUEUE_RETENTION_DAYS * 86_400_000;
  return state.items.filter((i) => Date.parse(i.capturedAt) < cutoff);
}

export function scanQueueLabel(state: ScanQueueState): string | null {
  const pending = state.items.filter((i) => i.status === "pending").length;
  const ready = readyToConfirm(state).length;
  if (pending === 0 && ready === 0) return null;
  const parts: string[] = [];
  if (pending) parts.push(`${pending} scan${pending === 1 ? "" : "s"} waiting for connection`);
  if (ready) parts.push(`${ready} ready to confirm`);
  return parts.join(" · ");
}
