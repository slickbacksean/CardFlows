import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COST_MISSING_LABEL, PNL_ESTIMATE_NOTE, pnlCsv, pnlRow, pnlTotals } from "./reseller-pnl";

describe("reseller P&L", () => {
  it("realized uses sale price minus fees minus all-in cost", () => {
    const row = pnlRow({ inventoryItemId: "a", name: "Pika", allInTotal: "10.00", sale: { price: "25", fees: "3.25" } });
    expect(row.status).toBe("realized");
    expect(row.netCents).toBe(1175);
    expect(row.netLabel).toBe("$11.75");
  });
  it("estimated uses asking then reference price with fee buffer", () => {
    const row = pnlRow({ inventoryItemId: "b", name: "X", allInTotal: "10", askingPrice: "20", referencePrice: "99", feesBufferPct: 10 });
    expect(row.status).toBe("estimated");
    expect(row.netCents).toBe(800);
    expect(pnlRow({ inventoryItemId: "c", name: "Y", allInTotal: "10", referencePrice: "5", feesBufferPct: 0 }).netLabel).toBe("-$5.00");
  });
  it("missing cost shows Cost missing, never $0", () => {
    const row = pnlRow({ inventoryItemId: "d", name: "Z", allInTotal: null, sale: { price: "25" } });
    expect(row.costLabel).toBe(COST_MISSING_LABEL);
    expect(row.netLabel).toBe(COST_MISSING_LABEL);
    expect(row.netCents).toBeNull();
    expect(pnlCsv([row])).toContain(COST_MISSING_LABEL);
    expect(pnlCsv([row]).split("\n")[1]).toBe("Z,Realized,Cost missing,25.00,0.00,,");
  });
  it("totals keep realized and estimated separate", () => {
    const totals = pnlTotals([
      pnlRow({ inventoryItemId: "a", name: "A", allInTotal: "10", sale: { price: "20" } }),
      pnlRow({ inventoryItemId: "b", name: "B", allInTotal: "10", askingPrice: "30", feesBufferPct: 0 }),
      pnlRow({ inventoryItemId: "c", name: "C", allInTotal: null, askingPrice: "30" }),
    ]);
    expect(totals).toEqual({ realizedNetCents: 1000, realizedCount: 1, estimatedNetCents: 2000, estimatedCount: 1, costMissingCount: 1 });
  });
  it("copy never promises profit or names graders", () => {
    expect(PNL_ESTIMATE_NOTE).not.toMatch(/profit|guarantee/i);
    const screen = readFileSync(resolve(__dirname, "../../../apps/mobile/app/pnl.tsx"), "utf8");
    expect(screen).toContain("pnlTotals");
    expect(screen).not.toMatch(/\bprofit\b|\bAI\b|PSA|BGS|CGC/i);
  });
});

describe("P&L sales sync", () => {
  it("phone saves sales through the offline queue and migrates local records once", () => {
    const sales = readFileSync(resolve(__dirname, "../../../apps/mobile/lib/sales.ts"), "utf8");
    expect(sales).toContain('runQueueableWrite("save_sale"');
    expect(sales).toContain('runQueueableWrite("delete_sale"');
    expect(sales).toContain("onlyIfMissing: true");
    expect(sales).toContain("migratedKey");
    const screen = readFileSync(resolve(__dirname, "../../../apps/mobile/app/pnl.tsx"), "utf8");
    expect(screen).toContain("migrateLocalSales");
  });
});
