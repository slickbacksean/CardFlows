/** P2-03 sale records for the P&L. Contract: `salesRoutes`. Per-user; copy must be the caller's. */
import { centsToDollarString, INVALID_DOLLAR_AMOUNT, parseDollarsToCents } from "@cardflow/shared";
import type { CardFlowApp } from "../app-env";
import type { CardSaleRecord, SalesStore } from "../sales-store";

export interface SalesRouteDeps {
  sales: SalesStore;
  ownsInventoryItem(userId: string, inventoryItemId: string): boolean;
  now?: () => Date;
}

function view(record: CardSaleRecord) {
  return {
    inventoryItemId: record.inventoryItemId,
    price: centsToDollarString(record.priceCents),
    fees: record.feesCents === null ? null : centsToDollarString(record.feesCents),
    soldAt: record.soldAt,
    updatedAt: record.updatedAt,
  };
}

export function registerSalesRoutes(app: CardFlowApp, deps: SalesRouteDeps): void {
  const now = deps.now ?? (() => new Date());

  app.get("/v1/sales", (c) =>
    c.json({ ok: true, sales: deps.sales.list(c.get("userId")).map(view) }),
  );

  app.post("/v1/sales/:inventoryItemId", async (c) => {
    const userId = c.get("userId");
    const inventoryItemId = c.req.param("inventoryItemId");
    if (!deps.ownsInventoryItem(userId, inventoryItemId)) {
      return c.json({ ok: false, error: "Inventory item not found" }, 404);
    }
    const body = await c.req
      .json<{ price?: unknown; fees?: unknown; soldAt?: unknown; onlyIfMissing?: unknown }>()
      .catch(() => ({}) as Record<string, unknown>);
    const priceCents = typeof body.price === "string" ? parseDollarsToCents(body.price) : null;
    const feesText = typeof body.fees === "string" && body.fees.trim() !== "" ? body.fees : null;
    const feesCents = feesText === null ? null : parseDollarsToCents(feesText);
    if (priceCents === null || (feesText !== null && feesCents === null)) {
      return c.json({ ok: false, error: INVALID_DOLLAR_AMOUNT }, 400);
    }
    const existing = deps.sales.get(userId, inventoryItemId);
    if (existing && body.onlyIfMissing === true) {
      return c.json({ ok: true, sale: view(existing), created: false });
    }
    const soldAt =
      typeof body.soldAt === "string" && !Number.isNaN(Date.parse(body.soldAt))
        ? new Date(body.soldAt).toISOString()
        : (existing?.soldAt ?? now().toISOString());
    const saved = deps.sales.save(userId, {
      inventoryItemId,
      priceCents,
      feesCents,
      soldAt,
      updatedAt: now().toISOString(),
    });
    return c.json({ ok: true, sale: view(saved), created: !existing });
  });

  app.delete("/v1/sales/:inventoryItemId", (c) => {
    const deleted = deps.sales.delete(c.get("userId"), c.req.param("inventoryItemId"));
    return c.json({ ok: true, deleted });
  });
}
