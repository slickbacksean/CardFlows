import * as SecureStore from "expo-secure-store";
import {
  POSTHOG_BATCH_MAX,
  POSTHOG_FLUSH_MS,
  PRODUCT_ANALYTICS_DEFAULT_ON,
  buildProductEvent,
  posthogBatchBody,
  posthogBatchUrl,
  posthogConfigFrom,
  type ProductEvent,
  type ProductEventName,
} from "@cardflow/shared";

/**
 * P1-19 / D7: opt-in product events, sent to PostHog cloud over its HTTP batch API only when
 * `EXPO_PUBLIC_POSTHOG_KEY` is set AND the user opted in. Turning analytics off drops the
 * unsent queue and the install ID. A small in-memory copy stays for the dev-only count.
 */
const OPT_IN_KEY = "cardflow.analytics.optIn.v1";
const INSTALL_KEY = "cardflow.analytics.installId.v1";
const BUFFER_MAX = 200;

let analyticsEnabled = PRODUCT_ANALYTICS_DEFAULT_ON;
let installId: string | null = null;
let buffer: ProductEvent[] = [];
let outbox: ProductEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const config = posthogConfigFrom({
  key: process.env.EXPO_PUBLIC_POSTHOG_KEY,
  host: process.env.EXPO_PUBLIC_POSTHOG_HOST,
});

function scheduleFlush() {
  if (!analyticsEnabled || !config) return;
  if (outbox.length >= POSTHOG_BATCH_MAX) void flushProductEvents();
  else flushTimer ??= setTimeout(() => void flushProductEvents(), POSTHOG_FLUSH_MS);
}

/** Best effort: on failure the batch is dropped (never retried forever, never persisted). */
export async function flushProductEvents(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (!analyticsEnabled || !config) return;
  const batch = outbox.splice(0, POSTHOG_BATCH_MAX);
  if (batch.length === 0) return;
  try {
    await fetch(posthogBatchUrl(config), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(posthogBatchBody(config, batch)),
    });
  } catch {
    // Dropped.
  }
  if (outbox.length > 0) scheduleFlush();
}
const scanStarts = new Map<string, number>();

function randomId(): string {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

export async function loadAnalyticsPreference(): Promise<boolean> {
  try {
    analyticsEnabled = (await SecureStore.getItemAsync(OPT_IN_KEY)) === "1";
    installId = await SecureStore.getItemAsync(INSTALL_KEY);
  } catch {
    analyticsEnabled = PRODUCT_ANALYTICS_DEFAULT_ON;
  }
  return analyticsEnabled;
}

const disabledListeners = new Set<() => void>();
/** Lets perf telemetry drop its pending timings when analytics is turned off. */
export function onAnalyticsDisabled(listener: () => void): () => void {
  disabledListeners.add(listener);
  return () => disabledListeners.delete(listener);
}

export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  analyticsEnabled = enabled;
  if (!enabled) {
    for (const listener of disabledListeners) listener();
    buffer = [];
    outbox = [];
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    scanStarts.clear();
    installId = null;
    await SecureStore.deleteItemAsync(INSTALL_KEY).catch(() => undefined);
  }
  await SecureStore.setItemAsync(OPT_IN_KEY, enabled ? "1" : "0").catch(() => undefined);
}

export function isAnalyticsEnabled(): boolean {
  return analyticsEnabled;
}

export function trackEvent(name: ProductEventName, props?: Record<string, unknown>): void {
  if (!analyticsEnabled) return;
  if (!installId) {
    installId = randomId();
    void SecureStore.setItemAsync(INSTALL_KEY, installId).catch(() => undefined);
  }
  const event = buildProductEvent(name, props, installId);
  buffer.push(event);
  if (buffer.length > BUFFER_MAX) buffer = buffer.slice(-BUFFER_MAX);
  if (!analyticsEnabled || !config) return;
  outbox.push(event);
  if (outbox.length > BUFFER_MAX) outbox = outbox.slice(-BUFFER_MAX);
  scheduleFlush();
}

/** Marks a scan's start so later events can carry `time_to_confirm_ms`. */
export function trackScanStarted(key: string, source: string, startedAt: number = Date.now()): void {
  if (!analyticsEnabled) return;
  scanStarts.set(key, startedAt);
  trackEvent("scan_started", { source });
}

export function msSinceScan(key: string): number | undefined {
  const start = scanStarts.get(key);
  return start === undefined ? undefined : Date.now() - start;
}

export function recentProductEvents(): ProductEvent[] {
  return [...buffer];
}

export function isPosthogConfigured(): boolean {
  return config !== null;
}
