/** Distinct incomplete Purchased state. Cost columns stay empty until the form is filled. */
export const DETAILS_NEEDED_WORKFLOW_STATE = "details_needed" as const;
export const DETAILS_NEEDED_LABEL = "Details needed";
export const LIVESTREAM_SOURCE_TAG = "livestream";
export const WATCHLIST_CLOSED_WORKFLOW_STATE = "watchlist_closed" as const;
/** Purchased copies converted from Watchlist keep this tag plus `from_watchlist:{id}`. */
export const WATCHLIST_SOURCE_TAG = "from_watchlist";
export const DETAILS_NEEDED_DEBOUNCE_MS = 8_000;
/** Livestream HUD and Watchlist Purchased toast. Undo within this window reverses the write. */
export const PURCHASED_UNDO_TOAST_MS = 5_000;
export const PURCHASED_UNDO_TOAST_MESSAGE = "Marked Purchased · Undo";
export const PURCHASED_UNDO_ACTION_LABEL = "Undo";

export type DetailsNeededWorkflowState = typeof DETAILS_NEEDED_WORKFLOW_STATE;

export type LivestreamSourcePlatform = "whatnot" | "ebay";

export interface DetailsNeededInventoryCopy {
  intent?: string | null;
  workflowState?: string | null;
  purchase?: unknown;
  allInTotal?: string | null;
}

export function detailsNeededCostBasis(): {
  purchasePrice: null;
  shipping: "0.00";
  tax: "0.00";
  fees: "0.00";
  supplies: "0.00";
  allInTotal: null;
} {
  return {
    purchasePrice: null,
    shipping: "0.00",
    tax: "0.00",
    fees: "0.00",
    supplies: "0.00",
    allInTotal: null,
  };
}

function storedPurchasePrice(purchase: unknown): string | null | undefined {
  if (!purchase || typeof purchase !== "object") return undefined;
  return (purchase as { costBasis?: { purchasePrice?: string | null } }).costBasis?.purchasePrice;
}

export function isDetailsNeededPurchase(copy: DetailsNeededInventoryCopy): boolean {
  if (copy.intent !== "purchased") return false;
  if (copy.workflowState === DETAILS_NEEDED_WORKFLOW_STATE) return true;
  const price = storedPurchasePrice(copy.purchase);
  return copy.purchase != null && (price === null || price === "");
}

/** All-in used by tiles, totals, and spread. Null purchase_price is not a $0 cost basis. */
export function purchasedAllInAmount(copy: DetailsNeededInventoryCopy): string | null {
  if (isDetailsNeededPurchase(copy)) return null;
  const price = storedPurchasePrice(copy.purchase);
  if (price === null || price === "") return null;
  if (copy.purchase && typeof copy.purchase === "object") {
    const costBasis = (copy.purchase as { costBasis?: { allInTotal?: string | null } }).costBasis;
    if (costBasis?.allInTotal) return costBasis.allInTotal;
  }
  return copy.allInTotal ?? null;
}

export function normalizeLivestreamPlatform(
  value?: string | null,
): LivestreamSourcePlatform | null {
  const raw = value?.trim().toLowerCase();
  if (raw === "whatnot" || raw === "ebay") return raw;
  return null;
}

/** App-state URL only. Rejects scripted or non-https values; never scraped from a live page. */
export function sanitizeLivestreamUrl(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function livestreamContextTags(input: {
  platform?: string | null;
  streamUrl?: string | null;
}): string[] {
  const tags = ["raw", LIVESTREAM_SOURCE_TAG];
  const platform = normalizeLivestreamPlatform(input.platform);
  if (platform) tags.push(`${LIVESTREAM_SOURCE_TAG}:${platform}`);
  const url = sanitizeLivestreamUrl(input.streamUrl);
  if (url) tags.push(`${LIVESTREAM_SOURCE_TAG}_url:${url}`);
  return tags;
}

export function shouldAcceptLiveHudPurchaseTap(input: {
  matchKey: string;
  inFlightKey?: string | null;
  savedKeys?: Iterable<string>;
}): boolean {
  if (!input.matchKey) return false;
  if (input.inFlightKey === input.matchKey) return false;
  if (input.savedKeys) {
    for (const key of input.savedKeys) {
      if (key === input.matchKey) return false;
    }
  }
  return true;
}

export function isRecentDetailsNeededDuplicate(input: {
  existing: { cardflowCardId: string; createdAt: string } | null | undefined;
  cardflowCardId: string;
  nowMs?: number;
  windowMs?: number;
}): boolean {
  if (!input.existing || input.existing.cardflowCardId !== input.cardflowCardId) return false;
  const createdMs = Date.parse(input.existing.createdAt);
  if (!Number.isFinite(createdMs)) return false;
  const nowMs = input.nowMs ?? Date.now();
  const windowMs = input.windowMs ?? DETAILS_NEEDED_DEBOUNCE_MS;
  return nowMs - createdMs < windowMs;
}

export function isClosedWatchlist(item: {
  intent?: string | null;
  workflowState?: string | null;
  closedAt?: string | null;
}): boolean {
  if (item.intent !== "watchlist") return false;
  if (item.workflowState === WATCHLIST_CLOSED_WORKFLOW_STATE) return true;
  return Boolean(item.closedAt);
}

export function isOpenWatchlist(item: {
  intent?: string | null;
  workflowState?: string | null;
  closedAt?: string | null;
}): boolean {
  return item.intent === "watchlist" && !isClosedWatchlist(item);
}

/** Tags on the new Purchased copy so Undo can reopen the Watchlist row. */
export function watchlistConversionTags(watchlistItemId: string): string[] {
  return ["raw", WATCHLIST_SOURCE_TAG, `${WATCHLIST_SOURCE_TAG}:${watchlistItemId}`];
}

export function watchlistSourceIdFromTags(tags: Iterable<string> | null | undefined): string | null {
  if (!tags) return null;
  const prefix = `${WATCHLIST_SOURCE_TAG}:`;
  for (const tag of tags) {
    if (tag.startsWith(prefix) && tag.length > prefix.length) return tag.slice(prefix.length);
  }
  return null;
}
