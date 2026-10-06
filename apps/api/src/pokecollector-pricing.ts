import {
  CatalogProviderError,
  convertEurToUsdCents,
  emptyPriceEstimate,
  PRICE_ESTIMATE_DISCLAIMER,
  PRICE_ESTIMATE_LABEL,
  PRICE_ESTIMATE_REFERENCE_SOURCE,
  priceEstimateFromUsdDollars,
  centsToDollarString,
  POKECOLLECTOR_CARDS_PATH,
  POKECOLLECTOR_EXCHANGE_RATE_PATH,
  type CardFlowPriceEstimate,
  type CardPricingProvider,
  type PriceEstimateRequest,
} from "@cardflow/shared";
import {
  createPokecollectorFetcher,
  readPokecollectorJson,
  throwForPokecollectorStatus,
  type PokecollectorHttpOptions,
} from "./pokecollector-http";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function englishPokecollectorCardId(tcgdexId: string): string {
  return `${tcgdexId.trim()}_en`;
}

function firstPositive(values: unknown[]): number | null {
  for (const value of values) {
    const amount = asNumber(value);
    if (amount !== null) return amount;
  }
  return null;
}

function tcgplayerUsd(card: Record<string, unknown>, variant: string | null | undefined): number | null {
  const lowered = variant?.trim().toLowerCase() ?? "";
  if (lowered.includes("holo") && !lowered.includes("reverse")) {
    return firstPositive([card.price_tcg_holo_market, card.price_tcg_holo_mid, card.price_tcg_holo_low]);
  }
  if (lowered.includes("reverse")) {
    return firstPositive([
      card.price_tcg_reverse_market,
      card.price_tcg_reverse_mid,
      card.price_tcg_reverse_low,
    ]);
  }
  return firstPositive([
    card.price_tcg_normal_market,
    card.price_tcg_holo_market,
    card.price_tcg_reverse_market,
    card.price_tcg_normal_mid,
    card.price_tcg_holo_mid,
    card.price_tcg_reverse_mid,
    card.price_tcg_normal_low,
    card.price_tcg_holo_low,
    card.price_tcg_reverse_low,
  ]);
}

function cardmarketEur(card: Record<string, unknown>, variant: string | null | undefined): number | null {
  const lowered = variant?.trim().toLowerCase() ?? "";
  if (lowered.includes("holo") && !lowered.includes("reverse")) {
    return firstPositive([
      card.price_trend_holo,
      card.price_market_holo,
      card.price_avg7_holo,
      card.price_trend,
      card.price_market,
      card.price_avg7,
    ]);
  }
  return firstPositive([
    card.price_trend,
    card.price_market,
    card.price_avg7,
    card.price_avg1,
    card.price_low,
    card.price_trend_holo,
    card.price_market_holo,
    card.price_avg7_holo,
  ]);
}

function rateFromExchangePayload(value: unknown): number | null {
  if (!isRecord(value)) return null;
  return asNumber(value.rate);
}

export function estimateFromPokecollectorCard(
  tcgdexId: string,
  card: unknown,
  options: { eurUsdRate?: number | null; selectedVariant?: string | null } = {},
): CardFlowPriceEstimate {
  if (!isRecord(card)) return emptyPriceEstimate(tcgdexId);
  const usd = tcgplayerUsd(card, options.selectedVariant);
  if (usd !== null) {
    return priceEstimateFromUsdDollars(tcgdexId, usd, "tcgplayer_usd");
  }
  const eur = cardmarketEur(card, options.selectedVariant);
  if (eur === null) return emptyPriceEstimate(tcgdexId);
  const cents = convertEurToUsdCents(eur, options.eurUsdRate ?? 0);
  if (cents === null) return emptyPriceEstimate(tcgdexId);
  const amount = centsToDollarString(cents);
  return {
    tcgdexId,
    currency: "USD",
    amountCents: cents,
    amount,
    source: "cardmarket_eur_converted",
    referenceSource: PRICE_ESTIMATE_REFERENCE_SOURCE,
    label: PRICE_ESTIMATE_LABEL,
    notAMarket: true,
    notABid: true,
    display: `Estimate $${amount}`,
    disclaimer: PRICE_ESTIMATE_DISCLAIMER,
  };
}

/**
 * Server-only PokéCollector pricing. Prefers TCGPlayer USD; otherwise converts
 * Cardmarket EUR. Returns a CardFlow estimate DTO — never vendor blobs.
 */
export function createPokecollectorPricingProvider(
  options: PokecollectorHttpOptions,
): CardPricingProvider {
  const http = createPokecollectorFetcher(options);
  let cachedEurUsd: number | null | undefined;

  async function eurUsdRate(): Promise<number | null> {
    if (cachedEurUsd !== undefined) return cachedEurUsd;
    try {
      const response = await http.request(
        `${POKECOLLECTOR_EXCHANGE_RATE_PATH}?from=EUR&to=USD`,
      );
      throwForPokecollectorStatus(response);
      if (!response.ok) {
        cachedEurUsd = null;
        return null;
      }
      cachedEurUsd = rateFromExchangePayload(await readPokecollectorJson(response));
      return cachedEurUsd;
    } catch (error) {
      if (error instanceof CatalogProviderError) {
        cachedEurUsd = null;
        return null;
      }
      cachedEurUsd = null;
      return null;
    }
  }

  return {
    name: "pokecollector",
    async getEstimate(req: PriceEstimateRequest): Promise<CardFlowPriceEstimate> {
      const tcgdexId = req.tcgdexId.trim();
      if (!tcgdexId) return emptyPriceEstimate(req.tcgdexId);
      try {
        const response = await http.request(
          `${POKECOLLECTOR_CARDS_PATH}/${encodeURIComponent(englishPokecollectorCardId(tcgdexId))}`,
        );
        throwForPokecollectorStatus(response);
        if (response.status === 404) return emptyPriceEstimate(tcgdexId);
        const card = await readPokecollectorJson(response);
        const usd = isRecord(card) ? tcgplayerUsd(card, req.selectedVariant) : null;
        const rate = usd === null ? await eurUsdRate() : null;
        return estimateFromPokecollectorCard(tcgdexId, card, {
          eurUsdRate: rate,
          selectedVariant: req.selectedVariant,
        });
      } catch {
        return emptyPriceEstimate(tcgdexId);
      }
    },
  };
}
