import * as SecureStore from "expo-secure-store";
import {
  PRODUCT_ANALYTICS_DEFAULT_ON,
  buildProductEvent,
  type ProductEvent,
  type ProductEventName,
} from "@cardflow/shared";

/**
 * P1-19: opt-in product events. No sink until the analytics tool is picked (D7): events stay
 * in a small in-memory buffer for dev inspection. Turning analytics off drops everything.
 */
const OPT_IN_KEY = "cardflow.analytics.optIn.v1";
const INSTALL_KEY = "cardflow.analytics.installId.v1";
const BUFFER_MAX = 200;

let analyticsEnabled = PRODUCT_ANALYTICS_DEFAULT_ON;
let installId: string | null = null;
let buffer: ProductEvent[] = [];
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

export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  analyticsEnabled = enabled;
  if (!enabled) {
    buffer = [];
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
  buffer.push(buildProductEvent(name, props, installId));
  if (buffer.length > BUFFER_MAX) buffer = buffer.slice(-BUFFER_MAX);
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
