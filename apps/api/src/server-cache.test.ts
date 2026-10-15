import { describe, expect, it } from "vitest";
import {
  emptyPriceEstimate,
  priceEstimateFromUsdDollars,
  type CardFlowNormalizedRecognitionResult,
  type CardPricingProvider,
} from "@cardflow/shared";
import {
  PRICE_CACHE_TTL_MS,
  cachedPricingProvider,
  createRecognitionCache,
  priceCacheKey,
  serverCacheEnabledFromEnv,
} from "./server-cache";

function countingPricing(amount: number | null) {
  let calls = 0;
  const provider: CardPricingProvider = {
    name: "mock",
    async getEstimate(req) {
      calls += 1;
      return amount == null ? emptyPriceEstimate(req.tcgdexId) : priceEstimateFromUsdDollars(req.tcgdexId, amount, "tcgplayer_usd");
    },
  };
  return { provider, calls: () => calls };
}

describe("P1-03 server caches", () => {
  it("caches prices per card + variant for 15 minutes with fetched_at", async () => {
    let t = 1_000_000;
    const base = countingPricing(4.2);
    const cached = cachedPricingProvider(base.provider, { now: () => t });
    const a = await cached.getEstimate({ tcgdexId: "base1-58", selectedVariant: "normal" });
    const b = await cached.getEstimate({ tcgdexId: "base1-58", selectedVariant: "normal" });
    expect(base.calls()).toBe(1);
    expect(b.fetchedAt).toBe(a.fetchedAt);
    expect(b.fetchedAt).toBe(new Date(1_000_000).toISOString());
    expect(cached.cache.get(priceCacheKey({ tcgdexId: "base1-58", selectedVariant: "normal" }))?.source).toBe("mock");
    await cached.getEstimate({ tcgdexId: "base1-58", selectedVariant: "holo" });
    expect(base.calls()).toBe(2);
    t += PRICE_CACHE_TTL_MS + 1;
    await cached.getEstimate({ tcgdexId: "base1-58", selectedVariant: "normal" });
    expect(base.calls()).toBe(3);
  });

  it("never caches an empty estimate", async () => {
    const base = countingPricing(null);
    const cached = cachedPricingProvider(base.provider);
    await cached.getEstimate({ tcgdexId: "x" });
    await cached.getEstimate({ tcgdexId: "x" });
    expect(base.calls()).toBe(2);
  });

  it("caches confident recognition by image hash only", async () => {
    const rc = createRecognitionCache();
    const ok = { ok: true, error: null, detections: [{}] } as unknown as CardFlowNormalizedRecognitionResult;
    const bad = { ok: false, error: { code: "x" }, detections: [] } as unknown as CardFlowNormalizedRecognitionResult;
    let calls = 0;
    const img = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };
    await rc.getOrIdentify(img, "mock", async () => (calls++, ok));
    await rc.getOrIdentify(img, "mock", async () => (calls++, ok));
    expect(calls).toBe(1);
    await rc.getOrIdentify({ ...img, bytes: new Uint8Array([9]) }, "mock", async () => (calls++, bad));
    await rc.getOrIdentify({ ...img, bytes: new Uint8Array([9]) }, "mock", async () => (calls++, bad));
    expect(calls).toBe(3);
  });

  it("can be switched off by env", () => {
    expect(serverCacheEnabledFromEnv({})).toBe(true);
    expect(serverCacheEnabledFromEnv({ CARD_FLOW_SERVER_CACHE: "0" })).toBe(false);
  });
});
