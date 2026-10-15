/**
 * Price reads through React Query (P1-02): prefetch on identify, cached
 * price with its age on Confirm, background refresh, never a blocking spinner
 * when anything is cached.
 */
import {
  PRICE_KEEP_MS,
  PRICE_PREFETCH_CANDIDATES,
  PRICE_STALE_MS,
  priceQueryKey,
  type CardFlowCanonicalCard,
} from "@cardflow/shared";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { getPriceEstimate } from "./api";
import { defaultVariantId } from "./variants";

export function priceQueryOptions(tcgdexId: string, variant: string | null | undefined) {
  return queryOptions({
    queryKey: priceQueryKey(tcgdexId, variant),
    queryFn: () => getPriceEstimate(tcgdexId, variant ?? undefined),
    staleTime: PRICE_STALE_MS,
    gcTime: PRICE_KEEP_MS,
    retry: 1,
  });
}

/** Warm the price cache for the top identify candidates. Errors are ignored. */
export function prefetchCandidatePrices(
  client: QueryClient,
  cards: readonly CardFlowCanonicalCard[],
  limit: number = PRICE_PREFETCH_CANDIDATES,
): void {
  const seen = new Set<string>();
  for (const card of cards) {
    if (seen.size >= limit) break;
    if (!card?.tcgdexId || seen.has(card.tcgdexId)) continue;
    seen.add(card.tcgdexId);
    const variant = defaultVariantId(card.variants, card.selectedVariant);
    void client.prefetchQuery(priceQueryOptions(card.tcgdexId, variant));
  }
}
