/**
 * D7: PostHog cloud for opt-in product events. Plain HTTP batch capture (no SDK), so nothing is
 * auto-captured: no screen views, app lifecycle, device model or session replay. Sends nothing
 * unless a project key is configured AND the user opted in. Props are the P1-19 sanitized set.
 */
import { sanitizeEventProps, type ProductEvent } from "./product-events";

export const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";
export const POSTHOG_BATCH_MAX = 20;
export const POSTHOG_FLUSH_MS = 30_000;

export interface PosthogConfig {
  apiKey: string;
  host: string;
}

/** Null (send nothing) unless a public project key (`phc_…`) is set. */
export function posthogConfigFrom(env: { key?: string | null; host?: string | null }): PosthogConfig | null {
  const apiKey = env.key?.trim();
  if (!apiKey || !/^phc_[A-Za-z0-9]+$/.test(apiKey)) return null;
  const host = (env.host?.trim() || POSTHOG_DEFAULT_HOST).replace(/\/+$/, "");
  if (!/^https:\/\//.test(host)) return null;
  return { apiKey, host };
}

export function posthogBatchUrl(config: PosthogConfig): string {
  return `${config.host}/batch/`;
}

export function posthogBatchBody(config: PosthogConfig, events: ProductEvent[]) {
  return {
    api_key: config.apiKey,
    historical_migration: false,
    batch: events.slice(0, POSTHOG_BATCH_MAX).map((event) => ({
      event: event.name,
      distinct_id: event.installId,
      timestamp: event.at,
      properties: {
        // Re-sanitize at the boundary so nothing else can ride along.
        ...sanitizeEventProps(event.props as Record<string, unknown>),
        $process_person_profile: false,
        $geoip_disable: true,
        $lib: "cardflow-http",
      },
    })),
  };
}
