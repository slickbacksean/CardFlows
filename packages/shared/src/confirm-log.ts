/**
 * P1-26: log what Confirm showed and what the user picked, then use those
 * counts to re-rank candidates and suggest likely variants.
 *
 * Metadata only: card ids, rank, confidence, provider, variant. No photos,
 * names, prices or stream URLs are stored.
 */
import type { TcgdexVariants } from "./types";

export const CONFIRM_EVENT_VIA = ["recognition", "candidate", "manual_search"] as const;
export type ConfirmEventVia = (typeof CONFIRM_EVENT_VIA)[number];

export interface ConfirmEvent {
  scanId: string;
  userId: string;
  via: ConfirmEventVia;
  /** Candidate ids in the order Confirm showed them (index 0 = rank 1). */
  shownTcgdexIds: string[];
  chosenTcgdexId: string;
  /** 1-based rank of the chosen card in `shownTcgdexIds`, or null if it wasn't shown. */
  chosenRank: number | null;
  selectedVariant: string | null;
  confidence: string | null;
  recognitionProvider: string | null;
  at: string;
}

export function confirmEventFor(input: {
  scanId: string;
  userId: string;
  via?: string | null;
  shownTcgdexIds: readonly string[];
  chosenTcgdexId: string;
  selectedVariant?: string | null;
  confidence?: string | null;
  recognitionProvider?: string | null;
  now?: Date;
}): ConfirmEvent {
  const shown = [...new Set(input.shownTcgdexIds.filter(Boolean))];
  const index = shown.indexOf(input.chosenTcgdexId);
  const chosenRank = index >= 0 ? index + 1 : null;
  const via: ConfirmEventVia =
    input.via === "manual_search" ? "manual_search" : chosenRank === 1 ? "recognition" : "candidate";
  return {
    scanId: input.scanId,
    userId: input.userId,
    via,
    shownTcgdexIds: shown,
    chosenTcgdexId: input.chosenTcgdexId,
    chosenRank,
    selectedVariant: input.selectedVariant ?? null,
    confidence: input.confidence ?? null,
    recognitionProvider: input.recognitionProvider ?? null,
    at: (input.now ?? new Date()).toISOString(),
  };
}

export function isConfirmCorrection(event: ConfirmEvent): boolean {
  return event.chosenRank !== 1;
}

/** Confirms per card id. */
export type ConfirmCounts = ReadonlyMap<string, number>;

export function confirmCountsFrom(events: Iterable<ConfirmEvent>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.chosenTcgdexId, (counts.get(event.chosenTcgdexId) ?? 0) + 1);
  return counts;
}

/** How much one confirmed card can move: about one rank per doubling of confirms. */
export const CONFIRM_RERANK_WEIGHT = 1;
/** Cards confirmed fewer times than this keep recognition's order. */
export const CONFIRM_RERANK_MIN_COUNT = 2;

/**
 * Stable re-rank of candidate ids. Score = -rank + weight·log2(1 + confirms).
 * Ties keep recognition's order, so with no history nothing moves.
 */
export function rerankByConfirms(ids: readonly string[], counts: ConfirmCounts): string[] {
  const scored = ids.map((id, index) => {
    const n = counts.get(id) ?? 0;
    const boost = n >= CONFIRM_RERANK_MIN_COUNT ? CONFIRM_RERANK_WEIGHT * Math.log2(1 + n) : 0;
    return { id, index, score: -index + boost };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.id);
}

export function rerankItemsByConfirms<T>(items: readonly T[], idOf: (item: T) => string, counts: ConfirmCounts): T[] {
  const order = rerankByConfirms(items.map(idOf), counts);
  const byId = new Map(items.map((item) => [idOf(item), item] as const));
  const out = order.map((id) => byId.get(id)!).filter(Boolean);
  // Keep any duplicates (same id twice) in place at the end rather than dropping them.
  return out.length === items.length ? out : [...items];
}

/**
 * Replay a time-ordered log: for each event, re-rank what was shown using only
 * the events before it, and count top-1 hits before and after.
 */
export function replayTop1(events: readonly ConfirmEvent[]): {
  events: number;
  baselineTop1: number;
  rerankedTop1: number;
} {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const counts = new Map<string, number>();
  let baselineTop1 = 0;
  let rerankedTop1 = 0;
  for (const event of sorted) {
    if (event.shownTcgdexIds[0] === event.chosenTcgdexId) baselineTop1 += 1;
    if (rerankByConfirms(event.shownTcgdexIds, counts)[0] === event.chosenTcgdexId) rerankedTop1 += 1;
    counts.set(event.chosenTcgdexId, (counts.get(event.chosenTcgdexId) ?? 0) + 1);
  }
  return { events: sorted.length, baselineTop1, rerankedTop1 };
}

export const VARIANT_LABELS: Record<keyof TcgdexVariants, string> = {
  holo: "Holo",
  reverse: "Reverse holo",
  firstEdition: "1st edition",
  normal: "Normal",
  wPromo: "W promo",
};

/**
 * Likely variants for Confirm: ones users picked most for this card first,
 * then whatever else the catalog says exists. Only real catalog variants.
 */
export function suggestVariants(input: {
  variants: TcgdexVariants | null | undefined;
  pickedVariantCounts?: ReadonlyMap<string, number>;
}): Array<{ variant: keyof TcgdexVariants; label: string; confirms: number }> {
  if (!input.variants) return [];
  const available = (Object.keys(VARIANT_LABELS) as Array<keyof TcgdexVariants>).filter(
    (key) => input.variants![key],
  );
  if (available.length < 2) return [];
  const counts = input.pickedVariantCounts ?? new Map<string, number>();
  return available
    .map((variant, index) => ({ variant, label: VARIANT_LABELS[variant], confirms: counts.get(variant) ?? 0, index }))
    .sort((a, b) => b.confirms - a.confirms || a.index - b.index)
    .map(({ variant, label, confirms }) => ({ variant, label, confirms }));
}
