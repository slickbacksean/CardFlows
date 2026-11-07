/**
 * Trending tab: anonymous popularity ranking, price deltas, and copy.
 * Pure functions so ranking and movers can be unit-tested without SQLite or HTTP.
 */
import { centsToDollarString } from "./money";

export const TRENDING_WINDOWS = ["24h", "7d"] as const;
export type TrendingWindow = (typeof TRENDING_WINDOWS)[number];

/** Skip penny-stock noise on movers. Sean: e.g. >= $2. */
export const TRENDING_MIN_PRICE_CENTS = 200;
export const TRENDING_DEFAULT_LIMIT = 20;
/** Below this, the list is a cold start — fall back to price ranking. */
export const TRENDING_POPULARITY_MIN_EVENTS = 20;
export const TRENDING_POPULARITY_MIN_DISTINCT_CARDS = 5;
/** Snapshot older than this is labeled stale on the payload. */
export const TRENDING_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export const TRENDING_DISABLED_COPY = "Trending is temporarily unavailable.";
export const POKEMONTCG_SOURCE_LABEL = "Price data from Pokémon TCG API (pokemontcg.io)";
export const POKEMONTCG_NOTICE =
  "Price data is for information only. See stores for final prices. This product is not produced, endorsed, supported, or affiliated with Nintendo or The Pokémon Company. Data provided by the Pokémon TCG API (pokemontcg.io).";
export const POKEMONTCG_SITE_URL = "https://pokemontcg.io";

export const TRENDING_POPULARITY_ACTIVITY_LABEL = "Most popular on PokeSniper";
export const TRENDING_POPULARITY_FALLBACK_LABEL =
  "Highest-value cards — not enough PokeSniper activity yet";

export const TRENDING_VARIANT_LABELS: Record<string, string> = {
  normal: "Normal",
  holofoil: "Holo",
  reverseHolofoil: "Reverse",
  "1stEditionHolofoil": "1st Edition Holo",
  "1stEditionNormal": "1st Edition",
  unlimitedHolofoil: "Unlimited Holo",
  unlimited: "Unlimited",
};

export function trendingVariantLabel(variant: string): string {
  return TRENDING_VARIANT_LABELS[variant] ?? variant;
}

export function isTrendingWindow(value: string | null | undefined): value is TrendingWindow {
  return value === "24h" || value === "7d";
}

export function parseTrendingWindow(raw: string | null | undefined): TrendingWindow {
  return raw === "24h" ? "24h" : "7d";
}

export function utcDateString(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function addUtcDays(isoDate: string, days: number): string {
  const at = new Date(`${isoDate}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return utcDateString(at);
}

export function previousSnapshotDate(asOf: string, window: TrendingWindow): string {
  return addUtcDays(asOf, window === "24h" ? -1 : -7);
}

export interface PricePoint {
  tcgdexId: string;
  variant: string;
  priceCents: number;
}

export interface PriceDelta {
  tcgdexId: string;
  variant: string;
  currentPriceCents: number;
  previousPriceCents: number;
  changeCents: number;
  changePercent: number;
}

/** Day-over-day / week-over-week market change. Null when the previous price is missing or zero. */
export function computePriceDelta(current: PricePoint, previous: PricePoint | null | undefined): PriceDelta | null {
  if (!previous) return null;
  if (current.tcgdexId !== previous.tcgdexId || current.variant !== previous.variant) return null;
  if (current.priceCents < 0 || previous.priceCents <= 0) return null;
  const changeCents = current.priceCents - previous.priceCents;
  const changePercent = (changeCents / previous.priceCents) * 100;
  if (!Number.isFinite(changePercent)) return null;
  return {
    tcgdexId: current.tcgdexId,
    variant: current.variant,
    currentPriceCents: current.priceCents,
    previousPriceCents: previous.priceCents,
    changeCents,
    changePercent,
  };
}

export function pairPriceDeltas(current: PricePoint[], previous: PricePoint[]): PriceDelta[] {
  const prior = new Map<string, PricePoint>();
  for (const row of previous) prior.set(`${row.tcgdexId}\0${row.variant}`, row);
  const out: PriceDelta[] = [];
  for (const row of current) {
    const delta = computePriceDelta(row, prior.get(`${row.tcgdexId}\0${row.variant}`));
    if (delta) out.push(delta);
  }
  return out;
}

function moverSortKey(delta: PriceDelta, direction: "up" | "down"): number {
  return direction === "up" ? -delta.changePercent : delta.changePercent;
}

/**
 * Rank movers, drop cheap noise, and keep one variant per catalog card (largest |%|).
 */
export function selectMovers(
  deltas: PriceDelta[],
  options: {
    direction: "up" | "down";
    limit?: number;
    minPriceCents?: number;
  },
): PriceDelta[] {
  const minPriceCents = options.minPriceCents ?? TRENDING_MIN_PRICE_CENTS;
  const limit = options.limit ?? TRENDING_DEFAULT_LIMIT;
  const wanted = deltas.filter((delta) => {
    if (delta.currentPriceCents < minPriceCents) return false;
    return options.direction === "up" ? delta.changePercent > 0 : delta.changePercent < 0;
  });
  wanted.sort((left, right) => {
    const byPct = moverSortKey(left, options.direction) - moverSortKey(right, options.direction);
    if (byPct !== 0) return byPct;
    return Math.abs(right.changeCents) - Math.abs(left.changeCents);
  });
  const seen = new Set<string>();
  const picked: PriceDelta[] = [];
  for (const delta of wanted) {
    if (seen.has(delta.tcgdexId)) continue;
    seen.add(delta.tcgdexId);
    picked.push(delta);
    if (picked.length >= limit) break;
  }
  return picked;
}

export interface ActivityCount {
  tcgdexId: string;
  /** Anonymous scan / identification events in the window. */
  scans: number;
  /** Anonymous MyDEX adds (purchased + watchlist) in the window. */
  mydexAdds: number;
}

export function popularityScore(row: ActivityCount): number {
  return Math.max(0, row.scans) + Math.max(0, row.mydexAdds);
}

export type PopularitySource = "pokesniper_activity" | "price_fallback";

export interface PopularityRank {
  tcgdexId: string;
  score: number;
}

export interface PopularityRanking {
  source: PopularitySource;
  sourceLabel: string;
  ranked: PopularityRank[];
}

export function shouldUsePopularityFallback(
  activity: ActivityCount[],
  options: { minEvents?: number; minDistinctCards?: number } = {},
): boolean {
  const minEvents = options.minEvents ?? TRENDING_POPULARITY_MIN_EVENTS;
  const minDistinct = options.minDistinctCards ?? TRENDING_POPULARITY_MIN_DISTINCT_CARDS;
  const scored = activity.filter((row) => popularityScore(row) > 0);
  const events = scored.reduce((sum, row) => sum + popularityScore(row), 0);
  return events < minEvents || scored.length < minDistinct;
}

export function rankByActivity(activity: ActivityCount[], limit: number): PopularityRank[] {
  return [...activity]
    .filter((row) => popularityScore(row) > 0 && row.tcgdexId)
    .sort((left, right) => {
      const byScore = popularityScore(right) - popularityScore(left);
      if (byScore !== 0) return byScore;
      return left.tcgdexId.localeCompare(right.tcgdexId);
    })
    .slice(0, limit)
    .map((row) => ({ tcgdexId: row.tcgdexId, score: popularityScore(row) }));
}

/** Cold-start ranking: highest current market price, then most dollars moved. */
export function rankByPriceFallback(
  prices: Array<{ tcgdexId: string; priceCents: number; absChangeCents?: number }>,
  limit: number,
): PopularityRank[] {
  const best = new Map<string, { tcgdexId: string; priceCents: number; absChangeCents: number }>();
  for (const row of prices) {
    if (!row.tcgdexId || row.priceCents <= 0) continue;
    const absChangeCents = row.absChangeCents ?? 0;
    const existing = best.get(row.tcgdexId);
    if (!existing || row.priceCents > existing.priceCents) {
      best.set(row.tcgdexId, { tcgdexId: row.tcgdexId, priceCents: row.priceCents, absChangeCents });
    }
  }
  return [...best.values()]
    .sort((left, right) => {
      if (right.priceCents !== left.priceCents) return right.priceCents - left.priceCents;
      if (right.absChangeCents !== left.absChangeCents) return right.absChangeCents - left.absChangeCents;
      return left.tcgdexId.localeCompare(right.tcgdexId);
    })
    .slice(0, limit)
    .map((row) => ({ tcgdexId: row.tcgdexId, score: row.priceCents }));
}

export function rankPopularCards(
  activity: ActivityCount[],
  prices: Array<{ tcgdexId: string; priceCents: number; absChangeCents?: number }>,
  options: { limit?: number; minEvents?: number; minDistinctCards?: number } = {},
): PopularityRanking {
  const limit = options.limit ?? TRENDING_DEFAULT_LIMIT;
  if (!shouldUsePopularityFallback(activity, options)) {
    return {
      source: "pokesniper_activity",
      sourceLabel: TRENDING_POPULARITY_ACTIVITY_LABEL,
      ranked: rankByActivity(activity, limit),
    };
  }
  return {
    source: "price_fallback",
    sourceLabel: TRENDING_POPULARITY_FALLBACK_LABEL,
    ranked: rankByPriceFallback(prices, limit),
  };
}

export function formatTrendingUsd(cents: number): string {
  return `$${centsToDollarString(cents)}`;
}

export function formatSignedUsd(cents: number): string {
  if (cents > 0) return `+$${centsToDollarString(cents)}`;
  if (cents < 0) return `-$${centsToDollarString(Math.abs(cents))}`;
  return `$${centsToDollarString(0)}`;
}

export function formatSignedPercent(changePercent: number): string {
  const rounded = Math.round(changePercent * 10) / 10;
  const body = `${Math.abs(rounded).toFixed(1)}%`;
  if (rounded > 0) return `+${body}`;
  if (rounded < 0) return `\u2212${body}`;
  return body;
}

/** pokemontcg.io `tcgplayer.updatedAt` is `YYYY/MM/DD`; our snapshot dates are `YYYY-MM-DD`. */
export function normalizePriceAsOfDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const slash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(trimmed);
  if (slash) return `${slash[1]}-${slash[2]!.padStart(2, "0")}-${slash[3]!.padStart(2, "0")}`;
  const day = trimmed.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function pricesAsOfLabel(isoDate: string | null | undefined): string | null {
  const day = normalizePriceAsOfDate(isoDate);
  if (!day) return null;
  const [year, month, date] = day.split("-").map(Number);
  const at = new Date(Date.UTC(year!, month! - 1, date));
  if (Number.isNaN(at.getTime())) return null;
  return `Prices as of ${at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

export function trendingSnapshotIsStale(snapshotDate: string | null | undefined, now: Date): boolean {
  if (!snapshotDate) return true;
  const at = Date.parse(`${snapshotDate.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at > TRENDING_STALE_AFTER_MS;
}

export interface TrendingCard {
  tcgdexId: string;
  name: string;
  setName: string;
  localId: string;
  imageUrl: string | null;
  variant: string;
  variantLabel: string;
  currentPriceCents: number | null;
  currentPriceUsd: string | null;
  activityCount?: number;
}

export interface TrendingMoverCard extends TrendingCard {
  currentPriceCents: number;
  previousPriceCents: number;
  changeCents: number;
  changePercent: number;
  currentPriceUsd: string;
  changeUsd: string;
}

export interface TrendingPayload {
  ok: true;
  window: TrendingWindow;
  pricesAsOf: string | null;
  snapshotDate: string | null;
  stale: boolean;
  popularity: {
    source: PopularitySource;
    sourceLabel: string;
    cards: TrendingCard[];
  };
  movers: {
    minPriceUsd: string;
    up: TrendingMoverCard[];
    down: TrendingMoverCard[];
  };
  unmatchedCount: number;
  attribution: {
    pokemontcg: string;
    tcgplayer: string;
  };
}
