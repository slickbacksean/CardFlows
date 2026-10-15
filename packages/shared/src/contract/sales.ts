/** P2-03 reseller sale records (per user, per inventory copy). */
import { z } from "zod";
import { defineRoute } from "./core";

export const CardSaleSchema = z.looseObject({
  inventoryItemId: z.string(),
  price: z.string(),
  fees: z.string().nullable(),
  soldAt: z.string(),
  updatedAt: z.string(),
});
export type CardSale = z.infer<typeof CardSaleSchema>;

export const SaveSaleBodySchema = z.object({
  price: z.string(),
  fees: z.string().nullable().optional(),
  soldAt: z.string().optional(),
  /** One-time local migration: keep the server copy when one exists. */
  onlyIfMissing: z.boolean().optional(),
});

export const salesRoutes = {
  listSales: defineRoute({
    method: "GET",
    path: "/v1/sales",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), sales: z.array(CardSaleSchema) }),
  }),
  saveSale: defineRoute({
    method: "POST",
    path: "/v1/sales/:inventoryItemId",
    bodyKind: "json",
    body: SaveSaleBodySchema,
    response: z.looseObject({ ok: z.literal(true), sale: CardSaleSchema, created: z.boolean() }),
  }),
  deleteSale: defineRoute({
    method: "DELETE",
    path: "/v1/sales/:inventoryItemId",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), deleted: z.boolean() }),
  }),
} as const;
