/**
 * Prices never block (P1-02). The phone keeps the last price per card and
 * variant, shows it with its age while a refresh runs, and falls back to a
 * plain "unavailable" state with a field for your own price.
 */
import type { CardFlowPriceEstimate } from "./pricing";

/** A cached price is refreshed after this long on live screens. */
export const PRICE_STALE_MS = 15 * 60 * 1000;
/** Cached prices are kept this long for instant Confirm renders. */
export const PRICE_KEEP_MS = 24 * 60 * 60 * 1000;
/** How many identify candidates get their price prefetched. */
export const PRICE_PREFETCH_CANDIDATES = 3;

export const PRICE_UNAVAILABLE_ENTER_OWN_COPY = "Price unavailable. Enter your own." as const;
export const PRICE_REFRESHING_COPY = "Refreshing…" as const;
export const YOUR_PRICE_INPUT_LABEL = "Your price (USD)" as const;

export type PriceDisplayKind = "checking" | "price" | "unavailable";

export interface PriceDisplayState {
  kind: PriceDisplayKind;
  /** A cached price is on screen and a refresh is running behind it. */
  refreshing: boolean;
}

/**
 * What Confirm shows for the price. Any cached amount wins over a spinner or
 * an error; "checking" only appears when there is nothing cached at all.
 */
export function priceDisplayState(input: {
  estimate: Pick<CardFlowPriceEstimate, "amount"> | null | undefined;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
}): PriceDisplayState {
  if (input.estimate?.amount) return { kind: "price", refreshing: input.isFetching };
  if (input.isPending && input.isFetching && !input.isError) {
    return { kind: "checking", refreshing: false };
  }
  return { kind: "unavailable", refreshing: false };
}

/** Stable React Query key for one card's price. */
export function priceQueryKey(tcgdexId: string, variant: string | null | undefined) {
  return ["cardflow", "getPriceEstimate", { tcgdexId, variant: variant ?? null }] as const;
}

/** Caption under a Watchlist item's saved Max Buy (your rule, saved earlier). */
export const WATCHLIST_SAVED_MAX_BUY_META = "Your rule · saved with this Watchlist item" as const;
