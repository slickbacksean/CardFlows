import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { Directory, File, Paths } from "expo-file-system";
import {
  canQueueScan,
  dueScans,
  emptyScanQueue,
  enqueueScan,
  expiredScans,
  makePendingDue,
  markScanFailed,
  markScanOpened,
  markScanReady,
  parseScanQueue,
  removeQueuedScan,
  shouldRetryWrite,
  type ScanQueueState,
} from "@cardflow/shared";
import { apiErrorStatus, createScan } from "./api";
import { createRequestId } from "./request-id";
import { rememberScanCapture } from "./scan-capture";

/**
 * P1-10: scans taken offline. The still is already downscaled and re-encoded without metadata
 * by `prepareScanStill`; we copy it into the app's document directory so the OS can't purge it and
 * upload it with one idempotency key when back online (immediately on reconnect via NetInfo, which
 * ships in Expo Go). The local copy stays as the row/Confirm preview until the 30-day expiry.
 */
const FILE_NAME = "scan-queue-v1.json";
let state: ScanQueueState | null = null;
const listeners = new Set<() => void>();
let flushing = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function queueDir() {
  const dir = new Directory(Paths.document, "scan-queue");
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function load(): ScanQueueState {
  if (state) return state;
  try {
    const file = new File(Paths.document, FILE_NAME);
    state = file.exists ? parseScanQueue(file.textSync()) : emptyScanQueue();
  } catch {
    state = emptyScanQueue();
  }
  return state;
}

function save(next: ScanQueueState) {
  state = next;
  try {
    new File(Paths.document, FILE_NAME).write(JSON.stringify(next));
  } catch {
    // Stay in memory; the next save persists everything.
  }
  for (const listener of listeners) listener();
  schedule();
}

function deleteLocal(uri: string | null) {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = null;
  const pending = load().items.filter((i) => i.status === "pending");
  if (pending.length === 0) return;
  const wait = Math.max(1_000, Math.min(...pending.map((i) => i.nextAttemptAt)) - Date.now());
  timer = setTimeout(() => void flushScanQueue(), wait);
}

/** A guest hit the scan limit (403 signup_required). Not a real refusal of this scan. */
export function isSignupRequiredError(error: unknown): boolean {
  return (error as { signupRequired?: unknown } | null)?.signupRequired != null;
}

/** True when the error means "couldn't reach the server" (queue it) rather than a real refusal. */
export function isOfflineScanError(error: unknown): boolean {
  return shouldRetryWrite(apiErrorStatus(error));
}

/** Keep an offline still for later. Returns false when the queue is full or the copy failed. */
export function queueOfflineScan(input: {
  imageUri: string;
  mimeType: string;
  captureMethod: "camera_photo" | "manual_scan";
}): boolean {
  if (!canQueueScan(load())) return false;
  const id = createRequestId();
  try {
    const dest = new File(queueDir(), `${id}.jpg`);
    new File(input.imageUri).copy(dest);
    save(enqueueScan(load(), { id, fileUri: dest.uri, mimeType: input.mimeType, captureMethod: input.captureMethod }));
    return true;
  } catch {
    return false;
  }
}

export async function flushScanQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const old of expiredScans(load())) {
      deleteLocal(old.fileUri);
      save(removeQueuedScan(load(), old.id));
    }
    for (const item of dueScans(load())) {
      if (!item.fileUri) {
        save(removeQueuedScan(load(), item.id));
        continue;
      }
      try {
        const result = await createScan({
          captureMethod: item.captureMethod,
          imageUri: item.fileUri,
          imageMimeType: item.mimeType,
          idempotencyKey: item.id,
        });
        save(markScanReady(load(), item.id, result.scan.scanId));
      } catch (error) {
        if (isSignupRequiredError(error)) {
          // Guest 4th scan: keep it queued; the sign-up prompt is already showing (api.ts).
          // It sends once the user signs up.
          save(markScanFailed(load(), item.id));
          break;
        }
        if (isOfflineScanError(error)) {
          save(markScanFailed(load(), item.id));
          if (apiErrorStatus(error) == null) break; // Still offline.
        } else {
          deleteLocal(item.fileUri);
          save(removeQueuedScan(load(), item.id));
        }
      }
    }
  } finally {
    flushing = false;
    schedule();
  }
}

/** Opening a ready scan takes it off the "Ready to confirm" list. */
export function openReadyScan(queueId: string): string | null {
  const item = load().items.find((i) => i.id === queueId);
  if (!item?.scanId) return null;
  if (item.fileUri) rememberScanCapture(item.scanId, item.fileUri);
  save(markScanOpened(load(), queueId));
  return item.scanId;
}

export function startScanQueue(): () => void {
  load();
  void flushScanQueue();
  const sub = AppState.addEventListener("change", (next) => {
    if (next === "active") void flushScanQueue();
  });
  let wasOnline: boolean | null = null;
  const unsubscribeNet = NetInfo.addEventListener((net) => {
    const online = Boolean(net.isConnected) && net.isInternetReachable !== false;
    if (online && wasOnline === false) {
      save(makePendingDue(load()));
      void flushScanQueue();
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

export function useScanQueue(): ScanQueueState {
  return useSyncExternalStore(subscribe, load, emptyScanQueue);
}
