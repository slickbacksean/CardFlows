/**
 * Assemble GET /v1/trending from snapshotted TCGCSV (or pokemontcg.io fallback) prices + anonymous activity.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  TCGPLAYER_NOTICE,
  formatSignedUsd,
  formatTrendingUsd,
  normalizePriceAsOfDate,
  pairPriceDeltas,
  parseTrendingWindow,
  POKEMONTCG_NOTICE,
  TCGCSV_NOTICE,
  previousSnapshotDate,
  rankPopularCards,
  selectMovers,
  trendingSnapshotIsStale,
  TRENDING_DEFAULT_LIMIT,
  TRENDING_MIN_PRICE_CENTS,
  trendingVariantLabel,
  type ActivityCount,
  type PricePoint,
  type TrendingCard,
  type TrendingMoverCard,
  type TrendingPayload,
  type TrendingWindow,
} from "@cardflow/shared";
import {
  cardflowCards,
  crmInventoryItems,
  crmScans,
  pokemonTcgIdMap,
  pokemonTcgPriceSnapshots,
  pokemonTcgSnapshotRuns,
} from "./db/schema";
import type { SqliteStorePort } from "./sqlite-store";
import { trendingPriceSourceFromEnv } from "./trending-snapshot-run";

const ACTIVITY_WINDOW_MS: Record<TrendingWindow, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export function emptyTrendingPayload(window: TrendingWindow, now = new Date()): TrendingPayload {
  const priceSource = trendingPriceSourceFromEnv();
  return {
    ok: true,
    window,
    pricesAsOf: null,
    snapshotDate: null,
    stale: true,
    popularity: {
      source: "price_fallback",
      sourceLabel: "Highest-value cards — not enough PokeSniper activity yet",
      cards: [],
    },
    movers: {
      minPriceUsd: formatTrendingUsd(TRENDING_MIN_PRICE_CENTS),
      up: [],
      down: [],
    },
    unmatchedCount: 0,
    attribution: {
      pokemontcg: priceSource === "pokemontcg" ? POKEMONTCG_NOTICE : TCGCSV_NOTICE,
      tcgplayer: TCGPLAYER_NOTICE,
    },
  };
}

interface CatalogBits {
  name: string;
  setName: string;
  localId: string;
  imageUrl: string | null;
}

function catalogImageUrl(imageBaseUrl: string | null | undefined, fallback: string | null): string | null {
  if (imageBaseUrl) {
    const trimmed = imageBaseUrl.replace(/\/+$/, "");
    if (!trimmed) return fallback;
    if (/\.(webp|png|jpe?g)$/i.test(trimmed)) return trimmed;
    return `${trimmed}/high.webp`;
  }
  return fallback;
}

function localIdFromTcgdexId(tcgdexId: string): string {
  const idx = tcgdexId.indexOf("-");
  return idx === -1 ? tcgdexId : tcgdexId.slice(idx + 1);
}

export function loadTrendingPayload(
  store: SqliteStorePort,
  options: { window?: string | null; limit?: string | number | null; now?: Date } = {},
): TrendingPayload {
  const window = parseTrendingWindow(options.window ?? undefined);
  const limitRaw = typeof options.limit === "string" ? Number(options.limit) : options.limit;
  const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) && limitRaw ? Number(limitRaw) : TRENDING_DEFAULT_LIMIT));
  const now = options.now ?? new Date();
  const empty = emptyTrendingPayload(window, now);

  const latest = store.db
    .select({
      snapshotDate: pokemonTcgSnapshotRuns.snapshotDate,
      maxTcgplayerUpdatedAt: pokemonTcgSnapshotRuns.maxTcgplayerUpdatedAt,
      finishedAt: pokemonTcgSnapshotRuns.finishedAt,
    })
    .from(pokemonTcgSnapshotRuns)
    .where(eq(pokemonTcgSnapshotRuns.status, "success"))
    .orderBy(desc(pokemonTcgSnapshotRuns.finishedAt))
    .limit(1)
    .all()[0];

  const snapshotDate =
    latest?.snapshotDate ??
    store.db
      .select({ snapshotDate: pokemonTcgPriceSnapshots.snapshotDate })
      .from(pokemonTcgPriceSnapshots)
      .orderBy(desc(pokemonTcgPriceSnapshots.snapshotDate))
      .limit(1)
      .all()[0]?.snapshotDate ??
    null;

  const unmatchedCount = store.db
    .select({ n: sql<number>`count(*)` })
    .from(pokemonTcgIdMap)
    .where(eq(pokemonTcgIdMap.mappingStatus, "unmatched"))
    .all()[0]?.n ?? 0;

  if (!snapshotDate) {
    return { ...empty, unmatchedCount: Number(unmatchedCount) || 0 };
  }

  const previousDate = previousSnapshotDate(snapshotDate, window);
  const currentRows = loadPricePoints(store, snapshotDate);
  const previousRows = loadPricePoints(store, previousDate);
  const deltas = pairPriceDeltas(currentRows, previousRows);
  const catalog = loadCatalogBits(store, [
    ...currentRows.map((row) => row.tcgdexId),
    ...previousRows.map((row) => row.tcgdexId),
  ]);

  const activity = loadActivity(store, now, window);
  const absChange = new Map<string, number>();
  for (const delta of deltas) {
    const current = absChange.get(delta.tcgdexId) ?? 0;
    absChange.set(delta.tcgdexId, Math.max(current, Math.abs(delta.changeCents)));
  }
  const headline = headlinePrices(currentRows);
  const popularity = rankPopularCards(
    activity,
    headline.map((row) => ({
      tcgdexId: row.tcgdexId,
      priceCents: row.priceCents,
      absChangeCents: absChange.get(row.tcgdexId) ?? 0,
    })),
    { limit },
  );

  const activityById = new Map(activity.map((row) => [row.tcgdexId, row]));
  const priceByCard = new Map(headline.map((row) => [row.tcgdexId, row]));

  const popularCards: TrendingCard[] = popularity.ranked.map((rank) => {
    const bits = catalog.get(rank.tcgdexId);
    const price = priceByCard.get(rank.tcgdexId);
    const events = activityById.get(rank.tcgdexId);
    return {
      tcgdexId: rank.tcgdexId,
      name: bits?.name ?? rank.tcgdexId,
      setName: bits?.setName ?? "",
      localId: bits?.localId ?? localIdFromTcgdexId(rank.tcgdexId),
      imageUrl: bits?.imageUrl ?? null,
      variant: price?.variant ?? "normal",
      variantLabel: trendingVariantLabel(price?.variant ?? "normal"),
      currentPriceCents: price?.priceCents ?? null,
      currentPriceUsd: price ? formatTrendingUsd(price.priceCents) : null,
      activityCount: popularity.source === "pokesniper_activity" ? rank.score : events ? events.scans + events.mydexAdds : undefined,
    };
  });

  const toMover = (delta: (typeof deltas)[number]): TrendingMoverCard => {
    const bits = catalog.get(delta.tcgdexId);
    return {
      tcgdexId: delta.tcgdexId,
      name: bits?.name ?? delta.tcgdexId,
      setName: bits?.setName ?? "",
      localId: bits?.localId ?? localIdFromTcgdexId(delta.tcgdexId),
      imageUrl: bits?.imageUrl ?? null,
      variant: delta.variant,
      variantLabel: trendingVariantLabel(delta.variant),
      currentPriceCents: delta.currentPriceCents,
      previousPriceCents: delta.previousPriceCents,
      changeCents: delta.changeCents,
      changePercent: delta.changePercent,
      currentPriceUsd: formatTrendingUsd(delta.currentPriceCents),
      changeUsd: formatSignedUsd(delta.changeCents),
    };
  };

  const pricesAsOf = normalizePriceAsOfDate(latest?.maxTcgplayerUpdatedAt) ?? snapshotDate;
  return {
    ok: true,
    window,
    pricesAsOf,
    snapshotDate,
    stale: trendingSnapshotIsStale(snapshotDate, now),
    popularity: {
      source: popularity.source,
      sourceLabel: popularity.sourceLabel,
      cards: popularCards,
    },
    movers: {
      minPriceUsd: formatTrendingUsd(TRENDING_MIN_PRICE_CENTS),
      up: selectMovers(deltas, { direction: "up", limit }).map(toMover),
      down: selectMovers(deltas, { direction: "down", limit }).map(toMover),
    },
    unmatchedCount: Number(unmatchedCount) || 0,
    attribution: empty.attribution,
  };
}

function loadPricePoints(store: SqliteStorePort, snapshotDate: string): PricePoint[] {
  const rows = store.db
    .select({
      tcgdexId: pokemonTcgIdMap.tcgdexId,
      variant: pokemonTcgPriceSnapshots.variant,
      priceCents: pokemonTcgPriceSnapshots.marketPriceCents,
    })
    .from(pokemonTcgPriceSnapshots)
    .innerJoin(pokemonTcgIdMap, eq(pokemonTcgPriceSnapshots.pokemontcgCardId, pokemonTcgIdMap.pokemontcgCardId))
    .where(
      and(
        eq(pokemonTcgPriceSnapshots.snapshotDate, snapshotDate),
        eq(pokemonTcgIdMap.mappingStatus, "matched"),
      ),
    )
    .all();
  return rows
    .filter((row): row is { tcgdexId: string; variant: string; priceCents: number } => Boolean(row.tcgdexId))
    .map((row) => ({ tcgdexId: row.tcgdexId, variant: row.variant, priceCents: row.priceCents }));
}

function headlinePrices(points: PricePoint[]): PricePoint[] {
  const best = new Map<string, PricePoint>();
  for (const point of points) {
    const existing = best.get(point.tcgdexId);
    if (!existing || point.priceCents > existing.priceCents) best.set(point.tcgdexId, point);
  }
  return [...best.values()];
}

function loadCatalogBits(store: SqliteStorePort, tcgdexIds: string[]): Map<string, CatalogBits> {
  const unique = [...new Set(tcgdexIds.filter(Boolean))];
  const out = new Map<string, CatalogBits>();
  if (unique.length === 0) return out;

  const mapped = store.db
    .select({
      tcgdexId: pokemonTcgIdMap.tcgdexId,
      name: pokemonTcgIdMap.name,
      setName: pokemonTcgIdMap.setName,
      number: pokemonTcgIdMap.number,
      imageUrl: pokemonTcgIdMap.imageUrl,
    })
    .from(pokemonTcgIdMap)
    .where(eq(pokemonTcgIdMap.mappingStatus, "matched"))
    .all();
  for (const row of mapped) {
    if (!row.tcgdexId || !unique.includes(row.tcgdexId)) continue;
    out.set(row.tcgdexId, {
      name: row.name ?? row.tcgdexId,
      setName: row.setName ?? "",
      localId: row.number ?? localIdFromTcgdexId(row.tcgdexId),
      imageUrl: row.imageUrl,
    });
  }

  const cached = store.db
    .select({
      tcgdexId: cardflowCards.tcgdexId,
      name: cardflowCards.name,
      setName: cardflowCards.setName,
      localId: cardflowCards.localId,
      imageBaseUrl: cardflowCards.imageBaseUrl,
    })
    .from(cardflowCards)
    .all();
  for (const row of cached) {
    if (!unique.includes(row.tcgdexId)) continue;
    const existing = out.get(row.tcgdexId);
    out.set(row.tcgdexId, {
      name: row.name || existing?.name || row.tcgdexId,
      setName: row.setName || existing?.setName || "",
      localId: row.localId || existing?.localId || localIdFromTcgdexId(row.tcgdexId),
      imageUrl: catalogImageUrl(row.imageBaseUrl, existing?.imageUrl ?? null),
    });
  }
  return out;
}

function loadActivity(store: SqliteStorePort, now: Date, window: TrendingWindow): ActivityCount[] {
  const since = new Date(now.getTime() - ACTIVITY_WINDOW_MS[window]).toISOString();
  const scans = store.db
    .select({
      tcgdexId: cardflowCards.tcgdexId,
      n: sql<number>`count(*)`,
    })
    .from(crmScans)
    .innerJoin(cardflowCards, eq(crmScans.cardflowCardId, cardflowCards.cardflowCardId))
    .where(gte(crmScans.capturedAt, since))
    .groupBy(cardflowCards.tcgdexId)
    .all();
  const adds = store.db
    .select({
      tcgdexId: cardflowCards.tcgdexId,
      n: sql<number>`count(*)`,
    })
    .from(crmInventoryItems)
    .innerJoin(cardflowCards, eq(crmInventoryItems.cardflowCardId, cardflowCards.cardflowCardId))
    .where(gte(crmInventoryItems.createdAt, since))
    .groupBy(cardflowCards.tcgdexId)
    .all();
  const byId = new Map<string, ActivityCount>();
  for (const row of scans) {
    byId.set(row.tcgdexId, { tcgdexId: row.tcgdexId, scans: Number(row.n) || 0, mydexAdds: 0 });
  }
  for (const row of adds) {
    const existing = byId.get(row.tcgdexId) ?? { tcgdexId: row.tcgdexId, scans: 0, mydexAdds: 0 };
    existing.mydexAdds = Number(row.n) || 0;
    byId.set(row.tcgdexId, existing);
  }
  return [...byId.values()];
}
