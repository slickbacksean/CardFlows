/** Trending tab: popularity + market movers from snapshotted pokemontcg.io prices. */
import { z } from "zod";
import type { TrendingPayload } from "../trending";
import { defineRoute, typed } from "./core";

const TrendingCardSchema = z.looseObject({
  tcgdexId: z.string(),
  name: z.string(),
  setName: z.string(),
  localId: z.string(),
  imageUrl: z.string().nullable(),
  variant: z.string(),
  variantLabel: z.string(),
  currentPriceCents: z.number().nullable(),
  currentPriceUsd: z.string().nullable(),
  activityCount: z.number().optional(),
});

const TrendingMoverSchema = z.looseObject({
  tcgdexId: z.string(),
  name: z.string(),
  setName: z.string(),
  localId: z.string(),
  imageUrl: z.string().nullable(),
  variant: z.string(),
  variantLabel: z.string(),
  currentPriceCents: z.number(),
  previousPriceCents: z.number(),
  changeCents: z.number(),
  changePercent: z.number(),
  currentPriceUsd: z.string(),
  changeUsd: z.string(),
});

export const TrendingResponseSchema = typed<TrendingPayload>(
  z.looseObject({
    ok: z.literal(true),
    window: z.enum(["24h", "7d"]),
    pricesAsOf: z.string().nullable(),
    snapshotDate: z.string().nullable(),
    stale: z.boolean(),
    popularity: z.looseObject({
      source: z.enum(["pokesniper_activity", "price_fallback"]),
      sourceLabel: z.string(),
      cards: z.array(TrendingCardSchema),
    }),
    movers: z.looseObject({
      minPriceUsd: z.string(),
      up: z.array(TrendingMoverSchema),
      down: z.array(TrendingMoverSchema),
    }),
    unmatchedCount: z.number(),
    attribution: z.looseObject({
      pokemontcg: z.string(),
      tcgplayer: z.string(),
    }),
  }),
);

export const trendingRoutes = {
  getTrending: defineRoute({
    method: "GET",
    path: "/v1/trending",
    bodyKind: "none",
    query: z.object({
      window: z.string().optional(),
      limit: z.string().optional(),
    }),
    response: TrendingResponseSchema,
  }),
  runTrendingSnapshot: defineRoute({
    method: "POST",
    path: "/ops/trending/snapshot",
    bodyKind: "none",
    query: z.object({ force: z.string().optional() }),
    response: z.looseObject({
      ok: z.boolean(),
      status: z.string(),
      snapshotDate: z.string().nullable().optional(),
      cardsSeen: z.number().optional(),
      snapshotsWritten: z.number().optional(),
      matched: z.number().optional(),
      unmatched: z.number().optional(),
      skipped: z.boolean().optional(),
      error: z.string().optional(),
    }),
  }),
} as const;
