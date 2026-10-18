import { forbiddenAboutClaim } from "./about";
import { PREGRADE_COPY, pregradeCopyViolations } from "./pregrade-copy";
import type { MappingStatus } from "./types";

/** User-safe Confirm copy when identify cannot pick one English print. */
export const CONFIRM_COULD_NOT_CONFIRM_MESSAGE =
  "We couldn't confirm this card — search by English set and number";

export const CONFIRM_FAIL_SOFT_TITLE = "Couldn't confirm";

export const CONFIRM_COULD_NOT_IDENTIFY_TITLE = "Couldn't identify";

export const CONFIRM_AMBIGUOUS_TITLE = "Ambiguous — pick the print.";

export const CONFIRM_SEARCH_MANUALLY_LABEL = "Search manually";
/** P1-06: shown under a recognized card so a miss never strands the user. */
export const CONFIRM_NOT_THIS_CARD_LABEL = "Not this card? Search";

export const CONFIRM_FRAMES = [
  "high",
  "ambiguous",
  "no-card",
  "timeout",
  "rate-limit",
  "no-match",
  "rejected",
] as const;

export type ConfirmFrame = (typeof CONFIRM_FRAMES)[number];

/** Frames that must offer Search manually so a bad still can still Confirm. */
export const CONFIRM_SEARCH_FRAMES = [
  "ambiguous",
  "no-card",
  "no-match",
  "timeout",
  "rate-limit",
] as const;

export type ConfirmSearchFrame = (typeof CONFIRM_SEARCH_FRAMES)[number];

export function isConfirmSearchFrame(frame: ConfirmFrame): frame is ConfirmSearchFrame {
  return (CONFIRM_SEARCH_FRAMES as readonly string[]).includes(frame);
}

export interface ConfirmScanView {
  recognitionOk: boolean;
  recognitionCode?: string | null;
  detectionCount: number;
  mappingStatus: MappingStatus | string;
  hasCanonicalCard: boolean;
  scenario?: string | null;
}

/**
 * Confirm screen frame. No box → no-card. No hash/catalog map → no-match.
 * Ambiguous keeps the picker. Missing/oversize stills are fail-soft, not a timeout.
 */
export function confirmFrameFromScan(scan: ConfirmScanView): ConfirmFrame {
  const code = scan.recognitionCode ?? "";
  if (!scan.recognitionOk) {
    if (code === "RATE_LIMITED" || scan.scenario === "rate-limit") return "rate-limit";
    if (code === "BAD_REQUEST") return scan.detectionCount === 0 ? "no-card" : "no-match";
    return "timeout";
  }
  if (scan.detectionCount === 0) return "no-card";
  if (scan.mappingStatus === "ambiguous") return "ambiguous";
  if (scan.mappingStatus === "matched" && scan.hasCanonicalCard) return "high";
  return "no-match";
}

export function confirmFailSoftTitle(frame: ConfirmFrame): string {
  if (frame === "ambiguous") return CONFIRM_AMBIGUOUS_TITLE;
  if (frame === "no-match") return CONFIRM_COULD_NOT_IDENTIFY_TITLE;
  if (frame === "timeout") return "Recognition timed out";
  if (frame === "rate-limit") return "Too many scans";
  return CONFIRM_FAIL_SOFT_TITLE;
}

export function confirmFailSoftBody(frame: ConfirmFrame): string {
  if (frame === "timeout") return "Retryable. Nothing was confirmed.";
  if (frame === "rate-limit") return "Wait and retry. CardFlow did not save this card.";
  return CONFIRM_COULD_NOT_CONFIRM_MESSAGE;
}

export function forbiddenConfirmClaim(copy: string): string | null {
  return forbiddenAboutClaim(copy);
}

/** Heading on Confirm and Decide. Opens HOW_THIS_WORKS_PARAGRAPHS. */
export const HOW_THIS_WORKS_TITLE = "How this works" as const;
export const HOW_THIS_WORKS_OPEN_LABEL = HOW_THIS_WORKS_TITLE;
export const HOW_THIS_WORKS_CLOSE_LABEL = "Close" as const;

export const HOW_THIS_WORKS_PARAGRAPHS = [
  `${PREGRADE_COPY.title}. ${PREGRADE_COPY.disclaimer} It is a condition guess from your photos.`,
  "Each price is an estimate. It shows who supplied it and when it was last updated. It is not a bid and not a promise.",
  "Max Buy (your rule) is the most you said you want to pay. It uses your margin and fee rules. It is not a market price.",
  "High, Medium, or Low confidence tells you how sure the match or estimate is. It is not a guarantee.",
] as const;

export const PRICE_ESTIMATE_SCREEN_LABEL = "Price estimate" as const;
export const MAX_BUY_YOUR_RULE_LABEL = "Max Buy (your rule)" as const;
export const CONFIDENCE_SCREEN_LABEL = "Confidence" as const;
export const WHAT_THIS_MEANS_LABEL = "What does this mean?" as const;
export const PRICE_ESTIMATE_ONLY_LABEL = "Estimate only." as const;
export const PRICE_ESTIMATE_UNAVAILABLE_COPY = "No price estimate for this card yet." as const;
export const MAX_BUY_ENTER_REFERENCE_COPY = "Enter a reference price to compute Max Buy." as const;
export const PRICE_CHECKING_COPY = "Checking current price estimate…" as const;

export const PRICE_SOURCE_POKETRACE = "Poketrace" as const;
export const PRICE_SOURCE_CARDSIGHT = "CardSight" as const;
export const PRICE_SOURCE_POKECOLLECTOR = "PokéCollector" as const;
export const PRICE_SOURCE_YOUR_PRICE = "your price" as const;
export const PRICE_SOURCE_LISTED = "listed source" as const;

export const CONFIRM_TIPS = {
  estimate: PREGRADE_COPY.disclaimer,
  maxBuy:
    "Max Buy (your rule) is the most you said you want to pay after your margin and fees. It is guidance from your rules, not a market price.",
  confidence:
    "High, Medium, or Low describes how sure this match or estimate is. It is not a guarantee.",
  priceSource:
    "The source is who last supplied this price estimate. The time is when that estimate was last updated. Estimate only.",
} as const;

export const PRICE_SOURCE_KINDS = [
  "poketrace",
  "cardsight",
  "pokecollector",
  "your_price",
  "listed",
] as const;

export type PriceSourceKind = (typeof PRICE_SOURCE_KINDS)[number];

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function confirmLabelCopy(): string[] {
  return [
    HOW_THIS_WORKS_TITLE,
    HOW_THIS_WORKS_OPEN_LABEL,
    HOW_THIS_WORKS_CLOSE_LABEL,
    ...HOW_THIS_WORKS_PARAGRAPHS,
    PRICE_ESTIMATE_SCREEN_LABEL,
    MAX_BUY_YOUR_RULE_LABEL,
    CONFIDENCE_SCREEN_LABEL,
    WHAT_THIS_MEANS_LABEL,
    PRICE_ESTIMATE_ONLY_LABEL,
    PRICE_ESTIMATE_UNAVAILABLE_COPY,
    MAX_BUY_ENTER_REFERENCE_COPY,
    PRICE_CHECKING_COPY,
    PRICE_SOURCE_POKETRACE,
    PRICE_SOURCE_CARDSIGHT,
    PRICE_SOURCE_POKECOLLECTOR,
    PRICE_SOURCE_YOUR_PRICE,
    PRICE_SOURCE_LISTED,
    ...Object.values(CONFIRM_TIPS),
  ];
}

export function resolvePriceSourceKind(input: {
  provider?: string | null;
  source?: string | null;
  referenceSource?: string | null;
  userEntered?: boolean;
}): PriceSourceKind {
  if (input.userEntered) return "your_price";
  const tokens = [input.provider, input.source, input.referenceSource]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  if (/\byour[_ ]?price\b|\buser[_ -]?entered\b/.test(tokens)) return "your_price";
  if (tokens.includes("poketrace")) return "poketrace";
  if (tokens.includes("cardsight")) return "cardsight";
  if (tokens.includes("pokecollector")) return "pokecollector";
  return "listed";
}

export function priceSourceLabel(kind: PriceSourceKind): string {
  if (kind === "poketrace") return PRICE_SOURCE_POKETRACE;
  if (kind === "cardsight") return PRICE_SOURCE_CARDSIGHT;
  if (kind === "pokecollector") return PRICE_SOURCE_POKECOLLECTOR;
  if (kind === "your_price") return PRICE_SOURCE_YOUR_PRICE;
  return PRICE_SOURCE_LISTED;
}

export function confidenceWord(
  value: string | null | undefined,
): "High" | "Medium" | "Low" | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "high") return "High";
  if (normalized === "medium") return "Medium";
  if (normalized === "low") return "Low";
  return null;
}

export function formatPriceUpdatedAt(
  fetchedAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!fetchedAt) return null;
  const then = new Date(fetchedAt);
  if (Number.isNaN(then.getTime())) return null;
  const deltaMs = now.getTime() - then.getTime();
  if (deltaMs < 45_000) return "Updated just now";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.round(deltaMs / 3_600_000);
  if (hours < 24) return hours === 1 ? "Updated 1 hour ago" : `Updated ${hours} hours ago`;
  const month = MONTH_SHORT[then.getMonth()];
  const day = then.getDate();
  if (then.getFullYear() === now.getFullYear()) return `Updated ${month} ${day}`;
  return `Updated ${month} ${day}, ${then.getFullYear()}`;
}

export function formatPriceEstimateMeta(input: {
  sourceLabel: string;
  fetchedAt?: string | null;
  now?: Date;
}): string {
  const updated = formatPriceUpdatedAt(input.fetchedAt, input.now);
  return updated
    ? `Estimate · ${input.sourceLabel} · ${updated}`
    : `Estimate · ${input.sourceLabel}`;
}

export function formatMaxBuyEstimateMeta(input: {
  sourceLabel: string;
  fetchedAt?: string | null;
  now?: Date;
}): string {
  return formatPriceEstimateMeta({
    sourceLabel: `based on ${input.sourceLabel}`,
    fetchedAt: input.fetchedAt,
    now: input.now,
  });
}

/** Words that must never appear as a profit promise or Max Buy-as-market label. */
export function forbiddenConfirmFinanceClaim(copy: string): string | null {
  if (/\bguaranteed profit\b/i.test(copy) || /\byou (will|made) \$\d/i.test(copy)) {
    return "profit_promise";
  }
  if (/\bMax Buy\b[^.]{0,48}\bmarket price\b/i.test(copy) && !/\bnot a market price\b/i.test(copy)) {
    return "max_buy_as_market";
  }
  return null;
}

export function confirmEstimateCopyViolations(copy: string): string[] {
  const finance = forbiddenConfirmFinanceClaim(copy);
  return [...pregradeCopyViolations(copy), ...(finance ? [finance] : [])];
}
