import { DEFAULT_MAX_BUY_PREFERENCES } from "./max-buy";
import { centsToDollarString, parseDollarsToCents } from "./money";

/**
 * Reseller P&L. Per-card all-in cost vs sale (realized) or asking/reference
 * price (estimated). Missing cost is "Cost missing", never $0.
 */
export const COST_MISSING_LABEL = "Cost missing";
export const PNL_ESTIMATE_NOTE =
  "Estimated rows use your asking price or reference price. Not a sale and not a promise of any result.";

export type PnlStatus = "realized" | "estimated" | "no_price";

export interface PnlInput {
  inventoryItemId: string;
  name: string;
  allInTotal: string | null | undefined;
  sale?: { price: string; fees?: string | null; soldAt?: string | null } | null;
  askingPrice?: string | null;
  referencePrice?: string | null;
  /** Fee buffer for estimated rows as a fraction (0.13 = 13%), same as `MaxBuyPreferences`. Clamped 0–0.5. */
  feesBufferPct?: number;
}

export interface PnlRow {
  inventoryItemId: string;
  name: string;
  status: PnlStatus;
  statusLabel: string;
  costLabel: string;
  costCents: number | null;
  priceCents: number | null;
  feesCents: number | null;
  netCents: number | null;
  netLabel: string;
  soldAt: string | null;
}

export interface PnlTotals {
  realizedNetCents: number;
  realizedCount: number;
  estimatedNetCents: number;
  estimatedCount: number;
  costMissingCount: number;
}

const STATUS_LABEL: Record<PnlStatus, string> = {
  realized: "Realized",
  estimated: "Estimated",
  no_price: "No price yet",
};

function cents(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  return parseDollarsToCents(value);
}

export function formatPnlMoney(centsValue: number): string {
  return centsValue < 0 ? `-$${centsToDollarString(-centsValue)}` : `$${centsToDollarString(centsValue)}`;
}

export function pnlRow(input: PnlInput): PnlRow {
  const costCents = cents(input.allInTotal);
  let status: PnlStatus = "no_price";
  let priceCents: number | null = null;
  let feesCents: number | null = null;
  const salePrice = input.sale ? cents(input.sale.price) : null;
  if (salePrice !== null) {
    status = "realized";
    priceCents = salePrice;
    feesCents = cents(input.sale?.fees ?? null) ?? 0;
  } else {
    const estimate = cents(input.askingPrice ?? null) ?? cents(input.referencePrice ?? null);
    if (estimate !== null) {
      status = "estimated";
      priceCents = estimate;
      const fraction = Math.min(0.5, Math.max(0, input.feesBufferPct ?? DEFAULT_MAX_BUY_PREFERENCES.feesBufferPct));
      feesCents = Math.round(estimate * fraction);
    }
  }
  const netCents =
    priceCents !== null && costCents !== null ? priceCents - (feesCents ?? 0) - costCents : null;
  return {
    inventoryItemId: input.inventoryItemId,
    name: input.name,
    status,
    statusLabel: STATUS_LABEL[status],
    costCents,
    costLabel: costCents === null ? COST_MISSING_LABEL : formatPnlMoney(costCents),
    priceCents,
    feesCents,
    netCents,
    netLabel:
      netCents !== null ? formatPnlMoney(netCents) : costCents === null ? COST_MISSING_LABEL : "—",
    soldAt: status === "realized" ? (input.sale?.soldAt ?? null) : null,
  };
}

export function pnlTotals(rows: readonly PnlRow[]): PnlTotals {
  const totals: PnlTotals = {
    realizedNetCents: 0,
    realizedCount: 0,
    estimatedNetCents: 0,
    estimatedCount: 0,
    costMissingCount: 0,
  };
  for (const row of rows) {
    if (row.costCents === null) totals.costMissingCount += 1;
    if (row.netCents === null) continue;
    if (row.status === "realized") {
      totals.realizedNetCents += row.netCents;
      totals.realizedCount += 1;
    } else if (row.status === "estimated") {
      totals.estimatedNetCents += row.netCents;
      totals.estimatedCount += 1;
    }
  }
  return totals;
}

export const PNL_CSV_HEADER = "Card,Status,All-in cost,Price,Fees,Net,Sold at";

function cell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function pnlCsv(rows: readonly PnlRow[]): string {
  const lines = rows.map((row) =>
    [
      row.name,
      row.statusLabel,
      row.costCents === null ? COST_MISSING_LABEL : centsToDollarString(row.costCents),
      row.priceCents === null ? "" : centsToDollarString(row.priceCents),
      row.feesCents === null ? "" : centsToDollarString(row.feesCents),
      row.netCents === null ? "" : (row.netCents < 0 ? "-" : "") + centsToDollarString(Math.abs(row.netCents)),
      row.soldAt ?? "",
    ]
      .map(cell)
      .join(","),
  );
  return [PNL_CSV_HEADER, ...lines].join("\n");
}
