/**
 * P1-19: privacy-safe product events. The analytics tool is undecided (D7), so there is
 * no sink yet: events are only kept in memory on the phone, and only when the user opts in
 * (default OFF). No advertising ID, no photos, no free text, no card names or prices.
 */
export const PRODUCT_EVENT_NAMES = [
  "scan_started",
  "candidates_shown",
  "confirm",
  "reject",
  "manual_search_used",
  "purchased",
  "details_completed",
  "draft_copied",
  "grade_started",
  "grade_retake",
  "grade_shown",
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

/** Allow-listed properties. Anything else is dropped. */
export const PRODUCT_EVENT_PROPS = ["time_to_confirm_ms", "ms_since_scan", "candidate_count", "rank", "source"] as const;
export type ProductEventProp = (typeof PRODUCT_EVENT_PROPS)[number];
export type ProductEventProps = Partial<Record<ProductEventProp, number | string>>;

export interface ProductEvent {
  name: ProductEventName;
  at: string;
  /** Random per-install id, rotated on reset. Never an advertising ID. */
  installId: string;
  props: ProductEventProps;
}

export const PRODUCT_ANALYTICS_DEFAULT_ON = false;
export const PRODUCT_ANALYTICS_LABEL = "Share usage analytics";
export const PRODUCT_ANALYTICS_NOTE =
  "Counts and timings only (for example, how long a scan takes to confirm), sent to PostHog, our analytics service. Never photos, card details, prices or anything you type. Off by default.";

/** `source` is a fixed set, so a search term or card ID can never ride along in it. */
export const PRODUCT_EVENT_SOURCES = ["camera_photo", "manual_scan", "candidate", "manual_search", "livestream", "practice"] as const;

export function isProductEventName(value: string): value is ProductEventName {
  return (PRODUCT_EVENT_NAMES as readonly string[]).includes(value);
}

export function sanitizeEventProps(props: Record<string, unknown> | undefined): ProductEventProps {
  const out: ProductEventProps = {};
  if (!props) return out;
  for (const key of PRODUCT_EVENT_PROPS) {
    const value = props[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = Math.round(value);
    else if (typeof value === "string" && key === "source" && (PRODUCT_EVENT_SOURCES as readonly string[]).includes(value)) out[key] = value;
  }
  return out;
}

export function buildProductEvent(
  name: ProductEventName,
  props: Record<string, unknown> | undefined,
  installId: string,
  now: Date = new Date(),
): ProductEvent {
  return { name, at: now.toISOString(), installId, props: sanitizeEventProps(props) };
}

/** Funnel steps for the scan → Purchased dashboard (once D7 picks a tool). */
export const PRODUCT_FUNNEL: ProductEventName[] = ["scan_started", "candidates_shown", "confirm", "purchased"];

export function funnelCounts(events: ProductEvent[]): Array<{ step: ProductEventName; count: number }> {
  return PRODUCT_FUNNEL.map((step) => ({ step, count: events.filter((e) => e.name === step).length }));
}
