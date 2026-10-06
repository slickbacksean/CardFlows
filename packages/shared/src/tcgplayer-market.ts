import { parseDollarsToCents } from "./money";

/** TCGPlayer market price in cents for each shop printing. */
export interface TcgplayerMarketCents {
  normal: number | null;
  holo: number | null;
  reverse: number | null;
  firstEdition: number | null;
}

export interface TcgplayerMarketVariants {
  firstEdition?: boolean;
  holo?: boolean;
  normal?: boolean;
  reverse?: boolean;
}

const EMPTY_MARKET: TcgplayerMarketCents = {
  normal: null,
  holo: null,
  reverse: null,
  firstEdition: null,
};

const META_KEYS = new Set(["unit", "updated"]);

/**
 * TCGPlayer market prices from a TCGdex card payload.
 * Unlimited is the non-1st-edition printing, so it fills Normal / Holo
 * when those keys are absent. 1st Edition stays on its own printing.
 */
export function tcgplayerMarketCents(
  card: unknown,
  variants: TcgplayerMarketVariants = {},
): TcgplayerMarketCents {
  const buckets = tcgplayerBuckets(card);
  if (buckets.size === 0) return { ...EMPTY_MARKET };
  const holoOnly = variants.holo === true && variants.normal !== true;
  const normalKeys = ["normal", "unlimited"];
  if (variants.holo !== true) normalKeys.push("holofoil", "unlimited-holofoil");
  const firstEditionKeys = holoOnly
    ? ["1st-edition-holofoil", "1st-edition"]
    : ["1st-edition", "1st-edition-holofoil"];
  return {
    normal: firstMarketCents(buckets, normalKeys),
    holo: firstMarketCents(buckets, ["unlimited-holofoil", "holofoil"]),
    reverse: firstMarketCents(buckets, ["reverse-holofoil", "reverse"]),
    firstEdition: firstMarketCents(buckets, firstEditionKeys),
  };
}

export function hasTcgplayerMarket(prices: TcgplayerMarketCents): boolean {
  return (
    prices.normal !== null ||
    prices.holo !== null ||
    prices.reverse !== null ||
    prices.firstEdition !== null
  );
}

/**
 * First shop printing that has a TCGPlayer market price.
 * Keeps the caller's order, so a priced Normal stays ahead of Holo.
 */
export function firstPricedPrinting(
  prices: TcgplayerMarketCents,
  printings: readonly string[],
): string | null {
  for (const printing of printings) {
    if (marketCentsForPrinting(prices, printing) !== null) return printing;
  }
  return null;
}

/** Shop printing query: `normal`, `holo`, `reverse`, or `first edition`. */
export function marketCentsForPrinting(
  prices: TcgplayerMarketCents,
  printing: string | null | undefined,
): number | null {
  const query = printing?.trim().toLowerCase() ?? "";
  if (query === "holo" || query === "holofoil") return prices.holo;
  if (query === "reverse" || query.includes("reverse")) return prices.reverse;
  if (query === "first edition" || query.includes("1st")) return prices.firstEdition;
  return prices.normal;
}

function tcgplayerBuckets(card: unknown): Map<string, number> {
  const buckets = new Map<string, number>();
  if (!isRecord(card)) return buckets;
  const sources: unknown[] = [isRecord(card.pricing) ? card.pricing.tcgplayer : null];
  if (Array.isArray(card.variants_detailed)) {
    for (const row of card.variants_detailed) {
      if (!isRecord(row) || !isRecord(row.pricing)) continue;
      sources.push(row.pricing.tcgplayer);
    }
  }
  for (const source of sources) {
    if (!isRecord(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      if (META_KEYS.has(key) || buckets.has(key)) continue;
      const cents = marketCents(value);
      if (cents !== null) buckets.set(key, cents);
    }
  }
  return buckets;
}

function firstMarketCents(buckets: Map<string, number>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const cents = buckets.get(key);
    if (cents !== undefined) return cents;
  }
  return null;
}

function marketCents(bucket: unknown): number | null {
  if (!isRecord(bucket)) return null;
  const market = bucket.marketPrice;
  if (typeof market !== "number" && typeof market !== "string") return null;
  const cents = parseDollarsToCents(market);
  if (cents === null || cents <= 0) return null;
  return cents;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
