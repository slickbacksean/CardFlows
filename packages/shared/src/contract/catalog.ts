/** Catalog search, canonical cards, pricing and slab comparisons. */
import { z } from "zod";
import type { TcgdexCard } from "../catalog";
import type { CardFlowCanonicalCard } from "../types";
import { defineRoute, typed } from "./core";
import { CanonicalCardSchema, PriceEstimateSchema, SlabEstimateSchema } from "./models";

export interface CatalogSearchResponse {
  ok: boolean;
  provider: "tcgdex" | "mock" | "pokecollector";
  language: "en";
  query: { set: string | null; number: string | null; name: string | null };
  userConfirmationRequired: true;
  autoConfirm: false;
  nameOnly: boolean;
  cards: CardFlowCanonicalCard[];
  cached: boolean;
  notice: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
}

const UserPriceSnapshotSchema = z.looseObject({
  snapshotId: z.string(),
  tcgdexId: z.string(),
  variant: z.string().nullable(),
  amount: z.string(),
  currency: z.literal("USD"),
  source: z.literal("you"),
  enteredAt: z.string(),
});

const CatalogError = z.looseObject({ code: z.string(), message: z.string(), retryable: z.boolean() });

export const CatalogSearchResponseSchema = typed<CatalogSearchResponse>(
  z.looseObject({
    ok: z.boolean(),
    provider: z.string(),
    query: z.looseObject({}),
    userConfirmationRequired: z.literal(true),
    autoConfirm: z.literal(false),
    cards: z.array(CanonicalCardSchema),
    error: CatalogError.nullable().optional(),
  }),
);

/** Raw TCGdex card from the catalog adapter (not yet a PokeSniper canonical card). */
export const TcgdexCardSchema = typed<TcgdexCard>(
  z.looseObject({
    id: z.string(),
    localId: z.string(),
    name: z.string(),
    image: z.string().nullable(),
    set: z.looseObject({ id: z.string() }),
    variants: z.looseObject({}),
    language: z.string(),
  }),
);

export const catalogRoutes = {
  searchCatalog: defineRoute({
    method: "GET",
    path: "/v1/catalog/search",
    bodyKind: "none",
    query: z.looseObject({
      set: z.string().optional(),
      number: z.string().optional(),
      name: z.string().optional(),
    }),
    response: CatalogSearchResponseSchema,
  }),
  getCatalogCard: defineRoute({
    method: "GET",
    path: "/v1/catalog/cards/:id",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), provider: z.string(), card: TcgdexCardSchema }),
  }),
  getCard: defineRoute({
    method: "GET",
    path: "/v1/cards/:cardflowCardId",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), canonicalCard: CanonicalCardSchema }),
  }),
  getPriceEstimate: defineRoute({
    method: "GET",
    path: "/v1/pricing/cards/:tcgdexId",
    bodyKind: "none",
    query: z.looseObject({ variant: z.string().optional() }),
    response: z.looseObject({
      ok: z.literal(true),
      provider: z.enum(["off", "pokecollector"]),
      estimate: PriceEstimateSchema,
    }),
  }),
  getSlabEstimates: defineRoute({
    method: "GET",
    path: "/v1/cards/:tcgdexId/slab-estimates",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), estimate: SlabEstimateSchema }),
  }),
  /** P1-12: your own reference prices for one card (newest first). */
  listUserPriceSnapshots: defineRoute({
    method: "GET",
    path: "/v1/pricing/cards/:tcgdexId/yours",
    bodyKind: "none",
    query: z.looseObject({ variant: z.string().optional() }),
    response: z.looseObject({ ok: z.literal(true), snapshots: z.array(UserPriceSnapshotSchema) }),
  }),
  saveUserPriceSnapshot: defineRoute({
    method: "POST",
    path: "/v1/pricing/cards/:tcgdexId/yours",
    bodyKind: "json",
    body: z.object({ amount: z.union([z.string(), z.number()]), variant: z.string().nullable().optional() }),
    response: z.looseObject({ ok: z.literal(true), snapshot: UserPriceSnapshotSchema }),
  }),
} as const;
