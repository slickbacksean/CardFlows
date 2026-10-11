/** Distinct incomplete Purchased state. Cost columns stay empty until the form is filled. */
export const DETAILS_NEEDED_WORKFLOW_STATE = "details_needed" as const;
export const DETAILS_NEEDED_LABEL = "Details needed";
export const LIVESTREAM_SOURCE_TAG = "livestream";
export const DETAILS_NEEDED_DEBOUNCE_MS = 8_000;

export type DetailsNeededWorkflowState = typeof DETAILS_NEEDED_WORKFLOW_STATE;

export type LivestreamSourcePlatform = "whatnot" | "ebay";

export interface DetailsNeededInventoryCopy {
  intent?: string | null;
  workflowState?: string | null;
  purchase?: unknown;
  allInTotal?: string | null;
}

export function isDetailsNeededPurchase(copy: DetailsNeededInventoryCopy): boolean {
  return copy.intent === "purchased" && copy.workflowState === DETAILS_NEEDED_WORKFLOW_STATE;
}

/** All-in used by tiles, totals, and spread. Incomplete Purchased copies contribute nothing. */
export function purchasedAllInAmount(copy: DetailsNeededInventoryCopy): string | null {
  if (isDetailsNeededPurchase(copy)) return null;
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
