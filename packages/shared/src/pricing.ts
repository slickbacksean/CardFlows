import { centsToDollarString, dollarsToCents, roundHalfUpToCent } from "./money";

export const PRICE_ESTIMATE_LABEL = "estimate" as const;
export const PRICE_ESTIMATE_DISCLAIMER =
  "This is an estimate, not a market or a bid.";
export const PRICE_ESTIMATE_REFERENCE_SOURCE = "tcgdex_via_pokecollector" as const;

export type PriceEstimateSource = "tcgplayer_usd" | "cardmarket_eur_converted" | "none";

export type PricingProviderName = "pokecollector" | "mock" | "off";

export interface CardFlowPriceEstimate {
  tcgdexId: string;
  currency: "USD";
  amountCents: number | null;
  amount: string | null;
  source: PriceEstimateSource;
  referenceSource: typeof PRICE_ESTIMATE_REFERENCE_SOURCE | "none";
  label: typeof PRICE_ESTIMATE_LABEL;
  notAMarket: true;
  notABid: true;
  display: string;
  disclaimer: string;
}

export interface PriceEstimateRequest {
  tcgdexId: string;
  language?: "en";
  selectedVariant?: string | null;
}

export interface CardPricingProvider {
  readonly name: PricingProviderName;
  readonly featureDisabled?: boolean;
  getEstimate(req: PriceEstimateRequest): Promise<CardFlowPriceEstimate>;
}

export function emptyPriceEstimate(
  tcgdexId: string,
  source: PriceEstimateSource = "none",
): CardFlowPriceEstimate {
  return {
    tcgdexId,
    currency: "USD",
    amountCents: null,
    amount: null,
    source,
    referenceSource: "none",
    label: PRICE_ESTIMATE_LABEL,
    notAMarket: true,
    notABid: true,
    display: "No estimate",
    disclaimer: PRICE_ESTIMATE_DISCLAIMER,
  };
}

export function priceEstimateFromUsdDollars(
  tcgdexId: string,
  usd: number,
  source: Exclude<PriceEstimateSource, "none">,
): CardFlowPriceEstimate {
  if (!Number.isFinite(usd) || usd <= 0) return emptyPriceEstimate(tcgdexId);
  const amountCents = dollarsToCents(usd);
  const amount = centsToDollarString(amountCents);
  return {
    tcgdexId,
    currency: "USD",
    amountCents,
    amount,
    source,
    referenceSource: PRICE_ESTIMATE_REFERENCE_SOURCE,
    label: PRICE_ESTIMATE_LABEL,
    notAMarket: true,
    notABid: true,
    display: `Estimate $${amount}`,
    disclaimer: PRICE_ESTIMATE_DISCLAIMER,
  };
}

export function convertEurToUsdCents(eur: number, eurUsdRate: number): number | null {
  if (!Number.isFinite(eur) || eur <= 0) return null;
  if (!Number.isFinite(eurUsdRate) || eurUsdRate <= 0) return null;
  return roundHalfUpToCent(eur * eurUsdRate * 100);
}

export interface CardFlowPortfolioSummary {
  currency: "USD";
  amountCents: number | null;
  amount: string | null;
  label: typeof PRICE_ESTIMATE_LABEL;
  notAMarket: true;
  notABid: true;
  display: string;
  disclaimer: string;
}

export function portfolioSummaryFromUsdCents(
  amountCents: number | null,
): CardFlowPortfolioSummary {
  const safeCents =
    amountCents === null || !Number.isFinite(amountCents) || amountCents <= 0
      ? null
      : Math.round(amountCents);
  const amount = safeCents === null ? null : centsToDollarString(safeCents);
  return {
    currency: "USD",
    amountCents: safeCents,
    amount,
    label: PRICE_ESTIMATE_LABEL,
    notAMarket: true,
    notABid: true,
    display: amount ? `Estimate $${amount}` : "No estimate",
    disclaimer: PRICE_ESTIMATE_DISCLAIMER,
  };
}

export function createOffPricingProvider(): CardPricingProvider {
  return {
    name: "off",
    featureDisabled: true,
    async getEstimate(req) {
      return emptyPriceEstimate(req.tcgdexId);
    },
  };
}

export const offPricingProvider = createOffPricingProvider();

/** Fixture estimate for CI. Never calls the network. */
export function createMockPricingProvider(
  estimates: Record<string, number> = { "base1-58": 8.25 },
): CardPricingProvider {
  return {
    name: "mock",
    async getEstimate(req) {
      const usd = estimates[req.tcgdexId];
      if (usd === undefined) return emptyPriceEstimate(req.tcgdexId);
      return priceEstimateFromUsdDollars(req.tcgdexId, usd, "tcgplayer_usd");
    },
  };
}
