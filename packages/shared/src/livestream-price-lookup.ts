/**
 * Livestream HUD price lookup helpers (P1).
 *
 * Default (CARD_FLOW_LIVESTREAM_PRICE_SNAPSHOT off): on-demand fetch of
 * GET /v1/livestream/guesses/:id with a short in-memory cache. No bulk download.
 *
 * Optional bulk snapshot (flag on): high TCGplayer licensing risk — leave off
 * until Policy review clears on-device caching of TCGplayer-derived prices.
 *
 * Optional link-out: a plain public TCGplayer search URL can replace the
 * in-app estimate ("See prices on TCGplayer").
 */

export const LIVESTREAM_PRICE_SNAPSHOT_FLAG = "CARD_FLOW_LIVESTREAM_PRICE_SNAPSHOT" as const;
export const LIVESTREAM_PRICE_SNAPSHOT_FLAG_PUBLIC =
  "EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_PRICE_SNAPSHOT" as const;

/** Default off. Only "1" / "true" enable the bulk snapshot path. */
export function livestreamPriceSnapshotEnabled(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const raw =
    env[LIVESTREAM_PRICE_SNAPSHOT_FLAG_PUBLIC]?.trim() ??
    env[LIVESTREAM_PRICE_SNAPSHOT_FLAG]?.trim() ??
    "";
  return raw === "1" || raw.toLowerCase() === "true";
}

/** In-memory on-demand cache TTL (about 10 minutes). */
export const LIVESTREAM_PRICE_CACHE_TTL_MS = 10 * 60 * 1000;

export const LIVESTREAM_TCGPLAYER_LINK_COPY = "See prices on TCGplayer" as const;

/**
 * Plain public TCGplayer Pokémon search URL. No API key, no product id required.
 * Prefer a product URL when the catalog later exposes tcgplayerProductId.
 */
export function tcgplayerPokemonSearchUrl(query: {
  name?: string | null;
  number?: string | null;
  setName?: string | null;
}): string {
  const parts = [query.name, query.number, query.setName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean);
  const q = encodeURIComponent(parts.join(" ") || "pokemon");
  return `https://www.tcgplayer.com/search/pokemon/product?q=${q}&view=grid&ProductTypeName=Cards`;
}

export interface LivestreamPriceCacheEntry<T> {
  value: T;
  fetchedAtMs: number;
}

/** Tiny TTL map for on-demand guess/price responses. Pure; no I/O. */
export function createLivestreamPriceCache<T>(ttlMs = LIVESTREAM_PRICE_CACHE_TTL_MS) {
  const entries = new Map<string, LivestreamPriceCacheEntry<T>>();
  return {
    get(key: string, nowMs = Date.now()): T | null {
      const entry = entries.get(key);
      if (!entry) return null;
      if (nowMs - entry.fetchedAtMs > ttlMs) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    set(key: string, value: T, nowMs = Date.now()) {
      entries.set(key, { value, fetchedAtMs: nowMs });
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}

export type LivestreamPriceCache<T> = ReturnType<typeof createLivestreamPriceCache<T>>;
