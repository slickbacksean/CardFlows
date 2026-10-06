import { describe, expect, it } from "vitest";
import { computeCostToAskSpread } from "./listing-draft";
import { centsToDollarString, dollarsToCents, parseDollarsToCents } from "./money";
import { computeMaxBuy, maxBuyPreferencesRangeError } from "./max-buy";

describe("parseDollarsToCents", () => {
  it("accepts a dollar sign and a comma decimal, and rounds 1.005 up", () => {
    expect(parseDollarsToCents("$5")).toBe(500);
    expect(parseDollarsToCents("12,50")).toBe(1250);
    expect(parseDollarsToCents("1.005")).toBe(101);
    expect(dollarsToCents("1.005")).toBe(101);
    expect(centsToDollarString(101)).toBe("1.01");
  });

  it("returns null for partial and negative input instead of throwing", () => {
    for (const value of ["1.2.", ".", "abc", "-50", ""]) {
      expect(parseDollarsToCents(value)).toBeNull();
    }
    expect(() =>
      computeCostToAskSpread({ askingPrice: "1.2.", allInTotal: "4.04" }),
    ).not.toThrow();
    expect(computeCostToAskSpread({ askingPrice: "$5", allInTotal: "4.04" })?.askingPrice).toBe(
      "5.00",
    );
  });

  it("rejects bad condition factors before Max Buy can show NaN", () => {
    expect(
      maxBuyPreferencesRangeError({
        targetMarginPct: 0.2,
        feesBufferPct: 0.13,
        conditionAdjustments: { NM: -5, LP: Number.NaN },
      }),
    ).toBe("Condition factor must be 0 or greater.");
    const guidance = computeMaxBuy({
      referencePriceAmount: "100",
      condition: "LP",
      preferences: {
        targetMarginPct: 0.2,
        feesBufferPct: 0.13,
        defaultCurrency: "USD",
        conditionAdjustments: { LP: Number.NaN },
      },
    });
    expect(guidance.maxBuyAmount).not.toMatch(/NaN/);
    expect(guidance.currentConditionFactor).toBe(1);
  });
});
