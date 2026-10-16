import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { posthogBatchBody, posthogBatchUrl, posthogConfigFrom } from "./posthog-sink";
import type { ProductEvent } from "./product-events";

describe("D7 PostHog sink", () => {
  it("is off until a phc_ key is set; host must be https", () => {
    expect(posthogConfigFrom({})).toBeNull();
    expect(posthogConfigFrom({ key: "  " })).toBeNull();
    expect(posthogConfigFrom({ key: "not-a-key" })).toBeNull();
    expect(posthogConfigFrom({ key: "phc_abc", host: "http://insecure" })).toBeNull();
    const cfg = posthogConfigFrom({ key: "phc_abc123" })!;
    expect(posthogBatchUrl(cfg)).toBe("https://us.i.posthog.com/batch/");
    expect(posthogBatchUrl(posthogConfigFrom({ key: "phc_abc123", host: "https://eu.i.posthog.com/" })!)).toBe("https://eu.i.posthog.com/batch/");
  });

  it("sends only sanitized props, no person profile, no GeoIP", () => {
    const leaky = {
      name: "confirm",
      at: "2026-10-15T00:00:00.000Z",
      installId: "abc",
      props: { time_to_confirm_ms: 1200, source: "candidate", query: "pikachu", tcgdexId: "base1-58" },
    } as unknown as ProductEvent;
    const body = posthogBatchBody(posthogConfigFrom({ key: "phc_k" })!, [leaky]);
    expect(body.api_key).toBe("phc_k");
    expect(body.batch[0]).toEqual({
      event: "confirm",
      distinct_id: "abc",
      timestamp: "2026-10-15T00:00:00.000Z",
      properties: { time_to_confirm_ms: 1200, source: "candidate", $process_person_profile: false, $geoip_disable: true, $lib: "cardflow-http" },
    });
    expect(JSON.stringify(body)).not.toMatch(/pikachu|base1-58/);
  });

  it("the phone only sends when opted in and configured, and opt-out drops the queue", () => {
    const lib = readFileSync(resolve(__dirname, "../../../apps/mobile/lib/product-events.ts"), "utf8");
    expect(lib).toContain("EXPO_PUBLIC_POSTHOG_KEY");
    expect(lib).toMatch(/if \(!analyticsEnabled \|\| !config\) return;/);
    expect(lib).not.toMatch(/advertising|IDFA|expo-tracking-transparency|posthog-react-native/i);
  });
});
