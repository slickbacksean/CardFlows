import { createHash } from "node:crypto";
import type {
  CardFlowNormalizedRecognitionResult,
  CardFlowPriceEstimate,
  CardPricingProvider,
  PriceEstimateRequest,
} from "@cardflow/shared";

/** P1-03: short-lived server caches. Every cached value carries its source and fetched_at. */
export const PRICE_CACHE_TTL_MS = 15 * 60 * 1000;
export const RECOGNITION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 5000;

export interface CacheEntry<T> {
  value: T;
  source: string;
  fetched_at: string;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly map = new Map<string, CacheEntry<T>>();
  hits = 0;
  misses = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
  ) {}

  get(key: string): CacheEntry<T> | undefined {
    const entry = this.map.get(key);
    if (!entry || entry.expiresAt <= this.now()) {
      if (entry) this.map.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    return entry;
  }

  set(key: string, value: T, source: string): CacheEntry<T> {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    const t = this.now();
    const entry = { value, source, fetched_at: new Date(t).toISOString(), expiresAt: t + this.ttlMs };
    this.map.set(key, entry);
    return entry;
  }

  get size() {
    return this.map.size;
  }
}

export function priceCacheKey(req: PriceEstimateRequest & { condition?: string | null }): string {
  return [req.tcgdexId.trim().toLowerCase(), req.selectedVariant ?? "", req.condition ?? "", req.language ?? "en"].join("|");
}

/** Wraps a pricing provider. Empty estimates (vendor miss/failure) are never cached. */
export function cachedPricingProvider(
  pricing: CardPricingProvider,
  options: { ttlMs?: number; now?: () => number } = {},
): CardPricingProvider & { cache: TtlCache<CardFlowPriceEstimate> } {
  const cache = new TtlCache<CardFlowPriceEstimate>(options.ttlMs ?? PRICE_CACHE_TTL_MS, options.now);
  return {
    name: pricing.name,
    featureDisabled: pricing.featureDisabled,
    cache,
    async getEstimate(req) {
      const key = priceCacheKey(req);
      const hit = cache.get(key);
      if (hit) return { ...hit.value, fetchedAt: hit.fetched_at };
      const fresh = await pricing.getEstimate(req);
      if (fresh.amountCents == null) return { ...fresh, fetchedAt: fresh.fetchedAt ?? null };
      const entry = cache.set(key, fresh, pricing.name);
      return { ...fresh, fetchedAt: fresh.fetchedAt ?? entry.fetched_at };
    },
  };
}

export function imageCacheKey(bytes: Uint8Array, mimeType: string): string {
  return createHash("sha256").update(mimeType).update("\0").update(bytes).digest("hex");
}

/** Recognition by image hash. Only confident, usable results are cached. */
export function createRecognitionCache(options: { ttlMs?: number; now?: () => number } = {}) {
  const cache = new TtlCache<CardFlowNormalizedRecognitionResult>(
    options.ttlMs ?? RECOGNITION_CACHE_TTL_MS,
    options.now,
  );
  return {
    cache,
    async getOrIdentify(
      image: { bytes: Uint8Array; mimeType: string },
      source: string,
      identify: () => Promise<CardFlowNormalizedRecognitionResult>,
    ): Promise<CardFlowNormalizedRecognitionResult> {
      // Keyed by source too, so a CardSight answer (consented user) is never reused for a user
      // whose photos stay on the local matcher, and vice versa.
      const key = `${source}:${imageCacheKey(image.bytes, image.mimeType)}`;
      const hit = cache.get(key);
      // Backend review: a cache hit is not a vendor call, so it never carries the vendor's request id.
      if (hit) return { ...hit.value, vendorRequestId: null };
      const result = await identify();
      if (isCacheableRecognition(result)) cache.set(key, result, source);
      return result;
    },
  };
}

function isCacheableRecognition(result: CardFlowNormalizedRecognitionResult): boolean {
  return result.ok && !result.error && result.detections.length > 0;
}

export function serverCacheEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CARD_FLOW_SERVER_CACHE?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off");
}
