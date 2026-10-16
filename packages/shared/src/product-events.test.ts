import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProductEvent, funnelCounts, PRODUCT_ANALYTICS_DEFAULT_ON, sanitizeEventProps } from "./product-events";

describe("P1-19 product events", () => {
  it("drops anything not allow-listed: free text, names, prices, URIs", () => {
    expect(
      sanitizeEventProps({ time_to_confirm_ms: 2412.6, source: "camera_photo", name: "Pikachu", price: 12, uri: "file:///x.jpg", note: "hi" }),
    ).toEqual({ time_to_confirm_ms: 2413, source: "camera_photo" });
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
  it("is off by default and has no ad ID", () => {
    expect(PRODUCT_ANALYTICS_DEFAULT_ON).toBe(false);
    const lib = readFileSync(resolve(__dirname, "../../../apps/mobile/lib/product-events.ts"), "utf8");
    expect(lib).not.toMatch(/advertising|IDFA|expo-tracking-transparency/i);
    expect(lib).toContain("analyticsEnabled");
  });

  it("strips search text and card IDs from manual_search_used, confirm and reject", () => {
    const leaky = {
      query: "pikachu base set", search: "charizard", name: "Pikachu", number: "58", setName: "Base Set",
      tcgdexId: "base1-58", cardflowCardId: "cf_123", scanId: "a1b2", inventoryItemId: "inv_1",
      source: "pikachu", time_to_confirm_ms: 1800,
    };
    for (const name of ["manual_search_used", "confirm", "reject"] as const) {
      const event = buildProductEvent(name, leaky, "i1");
      const text = JSON.stringify(event.props);
      expect(event.props).toEqual({ time_to_confirm_ms: 1800 });
      for (const bad of ["pikachu", "charizard", "base1-58", "cf_123", "a1b2", "inv_1", "Base Set", "58"]) {
        expect(text.toLowerCase()).not.toContain(bad.toLowerCase());
      }
    }
    expect(sanitizeEventProps({ source: "manual_search" })).toEqual({ source: "manual_search" });
    expect(sanitizeEventProps({ source: "base1_58" })).toEqual({});
  });
});
