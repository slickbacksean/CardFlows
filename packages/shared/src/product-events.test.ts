import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProductEvent, funnelCounts, PRODUCT_ANALYTICS_DEFAULT_ON, sanitizeEventProps } from "./product-events";

describe("P1-19 product events", () => {
  it("drops anything not allow-listed: free text, names, prices, URIs", () => {
    expect(
      sanitizeEventProps({ time_to_confirm_ms: 2412.6, source: "camera", name: "Pikachu", price: 12, uri: "file:///x.jpg", note: "hi" }),
    ).toEqual({ time_to_confirm_ms: 2413, source: "camera" });
    expect(sanitizeEventProps({ source: "Pikachu Base Set!" })).toEqual({});
    expect(sanitizeEventProps({ rank: -1, candidate_count: Number.NaN })).toEqual({});
  });
  it("builds events and a scan → Purchased funnel", () => {
    const e = (n: Parameters<typeof buildProductEvent>[0]) => buildProductEvent(n, {}, "i1", new Date("2026-10-15T00:00:00Z"));
    expect(funnelCounts([e("scan_started"), e("scan_started"), e("candidates_shown"), e("confirm")])).toEqual([
      { step: "scan_started", count: 2 },
      { step: "candidates_shown", count: 1 },
      { step: "confirm", count: 1 },
      { step: "purchased", count: 0 },
    ]);
  });
  it("is off by default, has no ad ID and no network sink until D7", () => {
    expect(PRODUCT_ANALYTICS_DEFAULT_ON).toBe(false);
    const lib = readFileSync(resolve(__dirname, "../../../apps/mobile/lib/product-events.ts"), "utf8");
    expect(lib).not.toMatch(/advertising|IDFA|expo-tracking-transparency|fetch\(/i);
    expect(lib).toContain("analyticsEnabled");
  });
});
