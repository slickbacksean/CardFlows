import { describe, expect, it, vi } from "vitest";
import {
  convertEurToUsdCents,
  createMockPricingProvider,
  createOffPricingProvider,
  emptyPriceEstimate,
  PRICE_ESTIMATE_DISCLAIMER,
  PRICE_ESTIMATE_LABEL,
  PRICE_ESTIMATE_REFERENCE_SOURCE,
  portfolioSummaryFromUsdCents,
  priceEstimateFromUsdDollars,
} from "./pricing";

describe("CardFlow price estimate DTO", () => {
  it("labels USD cents as an estimate, never a market or a bid", () => {
    const estimate = priceEstimateFromUsdDollars("base1-58", 8.25, "tcgplayer_usd");
    expect(estimate).toMatchObject({
      tcgdexId: "base1-58",
      currency: "USD",
      amountCents: 825,
      amount: "8.25",
      source: "tcgplayer_usd",
      referenceSource: PRICE_ESTIMATE_REFERENCE_SOURCE,
      label: PRICE_ESTIMATE_LABEL,
      notAMarket: true,
      notABid: true,
      display: "Estimate $8.25",
      disclaimer: PRICE_ESTIMATE_DISCLAIMER,
    });
    expect(estimate.disclaimer.toLowerCase()).toContain("estimate");
    expect(estimate.disclaimer.toLowerCase()).toMatch(/not a market or a bid/);
    expect(estimate.disclaimer.toLowerCase()).not.toContain("profit");
  });

  it("summarizes purchased copies as a USD estimate, never profit", () => {
    const summary = portfolioSummaryFromUsdCents(825);
    expect(summary).toMatchObject({
      currency: "USD",
      amountCents: 825,
      amount: "8.25",
      label: PRICE_ESTIMATE_LABEL,
      notAMarket: true,
      notABid: true,
      display: "Estimate $8.25",
      disclaimer: PRICE_ESTIMATE_DISCLAIMER,
    });
    expect(summary.display.toLowerCase()).not.toContain("profit");
    expect(JSON.stringify(summary).toLowerCase()).not.toContain("profit");
    expect(portfolioSummaryFromUsdCents(null).display).toBe("No estimate");
  });

  it("returns a null estimate when flag is off", async () => {
    const pricing = createOffPricingProvider();
    expect(pricing.name).toBe("off");
    expect(pricing.featureDisabled).toBe(true);
    expect(await pricing.getEstimate({ tcgdexId: "base1-58" })).toEqual(
      emptyPriceEstimate("base1-58"),
    );
  });

  it("converts Cardmarket EUR using the given rate and ignores missing rates", () => {
    expect(convertEurToUsdCents(10, 1.1)).toBe(1100);
    expect(convertEurToUsdCents(0, 1.1)).toBeNull();
    expect(convertEurToUsdCents(10, 0)).toBeNull();
  });

  it("mock pricing never calls the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("mock pricing must not call the network");
    });
    try {
      const pricing = createMockPricingProvider();
      const estimate = await pricing.getEstimate({ tcgdexId: "base1-58" });
      expect(estimate.amountCents).toBe(825);
      expect(await pricing.getEstimate({ tcgdexId: "missing" })).toMatchObject({
        amountCents: null,
        source: "none",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
