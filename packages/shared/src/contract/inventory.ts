/** Inventory (Purchased / Watchlist), collection, portfolio and listing drafts. */
import { z } from "zod";
import { defineRoute } from "./core";
import { CanonicalCardSchema, ClipboardExportSchema, PortfolioSummarySchema } from "./models";
import { DraftViewSchema, InventoryItemSchema, PortfolioHistoryPointSchema } from "./records";

const money = z.union([z.string(), z.number()]).nullable().optional();
const optText = z.string().nullable().optional();

const ItemResponse = z.looseObject({
  ok: z.literal(true),
  item: InventoryItemSchema,
  created: z.boolean().optional(),
});

const PurchaseCost = {
  purchasePrice: money,
  purchasedAt: optText,
  currency: optText,
  shipping: money,
  tax: money,
  fees: money,
  supplies: money,
  condition: optText,
  selectedVariant: optText,
  referencePriceAmount: money,
};

export const inventoryRoutes = {
  listInventory: defineRoute({
    method: "GET",
    path: "/v1/inventory",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), items: z.array(InventoryItemSchema) }),
  }),
  getInventoryItem: defineRoute({
    method: "GET",
    path: "/v1/inventory/:inventoryItemId",
    bodyKind: "none",
    response: z.looseObject({
      ok: z.literal(true),
      item: z.looseObject({ inventoryItemId: z.string(), intent: z.string() }),
      canonicalCard: CanonicalCardSchema.nullable(),
      draft: z.looseObject({ draftId: z.string() }).nullable(),
    }),
  }),
  deleteInventoryItem: defineRoute({
    method: "DELETE",
    path: "/v1/inventory/:inventoryItemId",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), deleted: z.literal(true) }),
  }),
  savePurchased: defineRoute({
    method: "POST",
    path: "/v1/inventory/purchased",
    bodyKind: "json",
    body: z.object({
      confirmationId: z.string(),
      detailsNeeded: z.boolean().optional(),
      platform: optText,
      streamUrl: optText,
      clientRequestId: optText,
      ...PurchaseCost,
    }),
    response: ItemResponse,
  }),
  saveWatchlist: defineRoute({
    method: "POST",
    path: "/v1/inventory/watchlist",
    bodyKind: "json",
    body: z.object({
      confirmationId: z.string(),
      selectedVariant: optText,
      referencePriceAmount: money,
      targetMaxBuyAmount: money,
      condition: optText,
    }),
    response: ItemResponse,
  }),
  convertWatchlistToPurchased: defineRoute({
    method: "POST",
    path: "/v1/inventory/:inventoryItemId/purchased",
    bodyKind: "none",
    response: ItemResponse,
  }),
  completePurchasedDetails: defineRoute({
    method: "POST",
    path: "/v1/inventory/:inventoryItemId/purchase",
    bodyKind: "json",
    body: z.object(PurchaseCost),
    response: ItemResponse,
  }),
  getCollection: defineRoute({
    method: "GET",
    path: "/v1/collection",
    bodyKind: "none",
    response: z.looseObject({
      ok: z.literal(true),
      items: z.array(z.looseObject({ tcgdexId: z.string().nullable() })),
    }),
  }),
  getPortfolio: defineRoute({
    method: "GET",
    path: "/v1/portfolio",
    bodyKind: "none",
    response: z.looseObject({
      ok: z.literal(true),
      currency: z.literal("USD"),
      portfolio: PortfolioSummarySchema,
    }),
  }),
  getPortfolioHistory: defineRoute({
    method: "GET",
    path: "/v1/portfolio/history",
    bodyKind: "none",
    query: z.looseObject({ range: z.enum(["7d", "30d", "90d", "all"]).optional() }),
    response: z.looseObject({
      ok: z.literal(true),
      currency: z.literal("USD"),
      range: z.enum(["7d", "30d", "90d", "all"]),
      today: z.string(),
      points: z.array(PortfolioHistoryPointSchema),
    }),
  }),
  openOrCreateDraft: defineRoute({
    method: "POST",
    path: "/v1/inventory/:inventoryItemId/drafts",
    bodyKind: "none",
    response: DraftViewSchema,
  }),
  getDraft: defineRoute({
    method: "GET",
    path: "/v1/drafts/:draftId",
    bodyKind: "none",
    response: DraftViewSchema,
  }),
  patchDraft: defineRoute({
    method: "PATCH",
    path: "/v1/drafts/:draftId",
    bodyKind: "json",
    body: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      condition: optText,
      askingPrice: money,
      intendedChannelNote: z.string().optional(),
      notes: z.string().optional(),
      titleTemplateId: z.string().optional(),
    }),
    response: DraftViewSchema,
  }),
  markDraftReady: defineRoute({
    method: "POST",
    path: "/v1/drafts/:draftId/ready",
    bodyKind: "none",
    response: DraftViewSchema,
  }),
  getDraftClipboard: defineRoute({
    method: "GET",
    path: "/v1/drafts/:draftId/clipboard",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), clipboard: ClipboardExportSchema }),
  }),
} as const;
