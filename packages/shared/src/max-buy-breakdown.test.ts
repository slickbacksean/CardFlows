import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { confirmEstimateCopyViolations } from "./confirm-copy";
import { computeMaxBuy, DEFAULT_MAX_BUY_PREFERENCES } from "./max-buy";
import { maxBuyBreakdown, maxBuyBreakdownCopy } from "./max-buy-breakdown";

describe("Max Buy breakdown (P1-13)", () => {
  it("defaults stay 20% margin and 13% fees", () => {
    expect(DEFAULT_MAX_BUY_PREFERENCES.targetMarginPct).toBe(0.2);
    expect(DEFAULT_MAX_BUY_PREFERENCES.feesBufferPct).toBe(0.13);
  });

  it("adds up to the shared calculator for many prices, rules and conditions", () => {
    const refs = ["0.01", "1.00", "8.00", "12.34", "99.99", "350.00", "1234.56"];
    const rules = [
      { targetMarginPct: 0.2, feesBufferPct: 0.13 },
      { targetMarginPct: 0, feesBufferPct: 0 },
      { targetMarginPct: 0.8, feesBufferPct: 0.5 },
      { targetMarginPct: 0.333, feesBufferPct: 0.071 },
    ];
    const adj = { NM: 1, LP: 0.85, MP: 0.7, HP: 0.5, DMG: 0.3 };
    for (const ref of refs) for (const rule of rules) for (const condition of [null, "NM", "LP", "DMG"]) {
      const m = computeMaxBuy({ referencePriceAmount: ref, condition, preferences: { ...rule, conditionAdjustments: adj } });
      const b = maxBuyBreakdown(m)!;
      const sum = b.lines.slice(0, 4).reduce((acc, l) => acc + l.cents, 0);
      expect(sum).toBe(m.maxBuyAmountCents);
      expect(b.lines[4]!.amount).toBe(m.maxBuyAmount);
    }
  });

  it("shows the default example: $8.00 → $5.57", () => {
    const b = maxBuyBreakdown(computeMaxBuy({ referencePriceAmount: "8.00" }))!;
    expect(b.lines.map((l) => [l.label, l.amount])).toEqual([
      ["Reference price", "8.00"],
      ["Fees 13%", "-1.04"],
      ["Your margin 20%", "-1.39"],
      ["Condition × 1", "0.00"],
      ["Max Buy (your rule)", "5.57"],
    ]);
  });

  it("is null without a reference price", () => {
    expect(maxBuyBreakdown(computeMaxBuy({ referencePriceAmount: null }))).toBeNull();
  });

  it("never says market price as a label or promises profit", () => {
    const b = maxBuyBreakdown(computeMaxBuy({ referencePriceAmount: "8" }))!;
    for (const line of [...maxBuyBreakdownCopy(), ...b.lines.map((l) => l.label)]) {
      expect(confirmEstimateCopyViolations(line)).toEqual([]);
      expect(line).not.toMatch(/guaranteed|you will make|you'll make/i);
    }
    for (const l of b.lines) expect(l.label).not.toMatch(/market/i);
    const here = dirname(fileURLToPath(import.meta.url));
    const screen = readFileSync(resolve(here, "../../../apps/mobile/components/ui/max-buy-breakdown.tsx"), "utf8");
    // The component only renders shared copy; no hard-coded "market price" text.
    expect(screen).not.toMatch(/market price/i);
  });
});
