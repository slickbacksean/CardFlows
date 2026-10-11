import { LOCKED_DISPLAY_CURRENCY } from "./max-buy";
import { parseDollarsToCents } from "./money";
import { PRICE_ESTIMATE_REFERENCE_SOURCE } from "./pricing";
import type { CardFlowSlabEstimate, SlabPricingSource } from "./slab-pricing";

export const LIVESTREAM_HUD_BUBBLE_HEIGHT = 108;
export const LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT = 168;
export const LIVESTREAM_HUD_BUBBLE_INSET = 12;
export const LIVESTREAM_HUD_POSITION_KEY = "cardflow.livestream.hud.position";
export const LIVE_HUD_QUICK_SAVE_ZERO = "0.00";
export const LIVE_HUD_PRICE_UNAVAILABLE = "unavailable";

/** Typical phone-width bar; live size is parent minus inset + safe area. */
export const LIVESTREAM_HUD_BUBBLE_WIDTH = 366;
/** @deprecated Use LIVESTREAM_HUD_BUBBLE_HEIGHT. */
export const LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE = LIVESTREAM_HUD_BUBBLE_HEIGHT;
/** @deprecated Full-width HUD sizes from the parent. */
export const LIVESTREAM_HUD_BUBBLE_EXPANDED_WIDTH = LIVESTREAM_HUD_BUBBLE_WIDTH;

export const LIVE_HUD_ALLOWED_PRICE_SOURCES = [
  PRICE_ESTIMATE_REFERENCE_SOURCE,
  "poketrace",
  "mock",
  "tcgplayer_usd",
] as const;

export type LivestreamHudSnapEdge = "top" | "bottom";

export interface LivestreamHudBubbleOffset {
  x: number;
  y: number;
}

export interface ClampLivestreamHudBubbleOffsetInput extends LivestreamHudBubbleOffset {
  parentWidth: number;
  parentHeight: number;
  bubbleWidth: number;
  bubbleHeight: number;
  inset?: number;
  safeTop?: number;
  safeRight?: number;
  safeBottom?: number;
  safeLeft?: number;
}

export interface SnapLivestreamHudBubbleOffsetResult extends LivestreamHudBubbleOffset {
  edge: LivestreamHudSnapEdge;
}

export interface LivestreamHudSavedPosition {
  edge: LivestreamHudSnapEdge;
}

export interface LiveHudPriceSlots {
  rawAmount: string | null;
  psa9Amount: string | null;
  psa10Amount: string | null;
  unavailable: boolean;
}

export interface LiveHudPriceMatch {
  estimateAmount?: string | null;
  rawAmount?: string | null;
  psa9Amount?: string | null;
  psa10Amount?: string | null;
  referenceSource?: string | null;
  source?: string | null;
  slabSource?: SlabPricingSource | null;
}

export interface LiveHudListingMatch {
  listingUrl?: string | null;
  name?: string | null;
  number?: string | null;
  setName?: string | null;
}

export interface LiveHudQuickSavePayload {
  purchasePrice: string;
  purchasedAt: string;
  currency: typeof LOCKED_DISPLAY_CURRENCY;
  shipping: typeof LIVE_HUD_QUICK_SAVE_ZERO;
  tax: typeof LIVE_HUD_QUICK_SAVE_ZERO;
  fees: typeof LIVE_HUD_QUICK_SAVE_ZERO;
  supplies: typeof LIVE_HUD_QUICK_SAVE_ZERO;
}

export function livestreamHudBubbleWidth(input: {
  parentWidth: number;
  safeLeft?: number;
  safeRight?: number;
  inset?: number;
}): number {
  const inset = input.inset ?? LIVESTREAM_HUD_BUBBLE_INSET;
  if (input.parentWidth <= 0) return 0;
  return Math.max(0, input.parentWidth - inset * 2 - (input.safeLeft ?? 0) - (input.safeRight ?? 0));
}

export function livestreamHudBubbleSize(
  expanded: boolean,
  layout: { parentWidth?: number; safeLeft?: number; safeRight?: number } = {},
): {
  width: number;
  height: number;
} {
  return {
    width: livestreamHudBubbleWidth({
      parentWidth: layout.parentWidth ?? 0,
      safeLeft: layout.safeLeft,
      safeRight: layout.safeRight,
    }),
    height: expanded ? LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT : LIVESTREAM_HUD_BUBBLE_HEIGHT,
  };
}

function safeBox(input: ClampLivestreamHudBubbleOffsetInput): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const inset = input.inset ?? LIVESTREAM_HUD_BUBBLE_INSET;
  const minX = inset + (input.safeLeft ?? 0);
  const minY = inset + (input.safeTop ?? 0);
  const maxX = input.parentWidth - input.bubbleWidth - inset - (input.safeRight ?? 0);
  const maxY = input.parentHeight - input.bubbleHeight - inset - (input.safeBottom ?? 0);
  return {
    minX,
    maxX: Math.max(minX, maxX),
    minY,
    maxY: Math.max(minY, maxY),
  };
}

/** Keep the floating bar on-screen inside the live region and safe area. */
export function clampLivestreamHudBubbleOffset(
  input: ClampLivestreamHudBubbleOffsetInput,
): LivestreamHudBubbleOffset {
  if (input.parentWidth <= 0 || input.parentHeight <= 0) {
    const inset = input.inset ?? LIVESTREAM_HUD_BUBBLE_INSET;
    return { x: inset + (input.safeLeft ?? 0), y: inset + (input.safeTop ?? 0) };
  }
  const box = safeBox(input);
  return {
    x: Math.min(box.maxX, Math.max(box.minX, input.x)),
    y: Math.min(box.maxY, Math.max(box.minY, input.y)),
  };
}

/** Spring target after a vertical drag: nearest top or bottom edge. X stays full-width left. */
export function snapLivestreamHudBubbleOffset(
  input: ClampLivestreamHudBubbleOffsetInput,
): SnapLivestreamHudBubbleOffsetResult {
  const inset = input.inset ?? LIVESTREAM_HUD_BUBBLE_INSET;
  if (input.parentWidth <= 0 || input.parentHeight <= 0) {
    return {
      x: inset + (input.safeLeft ?? 0),
      y: inset + (input.safeTop ?? 0),
      edge: "top",
    };
  }
  const box = safeBox(input);
  const centerY = input.y + input.bubbleHeight / 2;
  const edge: LivestreamHudSnapEdge = centerY < input.parentHeight / 2 ? "top" : "bottom";
  return {
    x: box.minX,
    y: edge === "top" ? box.minY : box.maxY,
    edge,
  };
}

export function defaultLivestreamHudSavedPosition(): LivestreamHudSavedPosition {
  return { edge: "top" };
}

export function serializeLivestreamHudPosition(position: LivestreamHudSavedPosition): string {
  return JSON.stringify({ edge: position.edge });
}

export function parseLivestreamHudPosition(raw: string | null | undefined): LivestreamHudSavedPosition | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { edge?: unknown };
    if (parsed.edge === "top" || parsed.edge === "bottom") return { edge: parsed.edge };
    if (parsed.edge === "left" || parsed.edge === "right") return { edge: "top" };
    return null;
  } catch {
    return null;
  }
}

export function livestreamHudOffsetFromSaved(input: {
  position: LivestreamHudSavedPosition;
  parentWidth: number;
  parentHeight: number;
  bubbleWidth: number;
  bubbleHeight: number;
  inset?: number;
  safeTop?: number;
  safeRight?: number;
  safeBottom?: number;
  safeLeft?: number;
}): SnapLivestreamHudBubbleOffsetResult {
  const guessedY = input.position.edge === "top" ? 0 : Math.max(input.parentHeight, 1);
  return snapLivestreamHudBubbleOffset({
    x: 0,
    y: guessedY,
    parentWidth: input.parentWidth,
    parentHeight: input.parentHeight,
    bubbleWidth: input.bubbleWidth,
    bubbleHeight: input.bubbleHeight,
    inset: input.inset,
    safeTop: input.safeTop,
    safeRight: input.safeRight,
    safeBottom: input.safeBottom,
    safeLeft: input.safeLeft,
  });
}

function dollarLabel(amount: string | null | undefined): string | null {
  if (!amount) return null;
  return amount.charAt(0) === "$" ? amount : `$${amount}`;
}

function isAllowedPriceSource(source: string | null | undefined): boolean {
  return Boolean(source && (LIVE_HUD_ALLOWED_PRICE_SOURCES as readonly string[]).includes(source));
}

function dollarAmount(amount: string | null | undefined): string | null {
  if (!amount) return null;
  const trimmed = amount.trim().replace(/^\$/, "");
  if (parseDollarsToCents(trimmed) === null) return null;
  return trimmed;
}

export function emptyLiveHudPriceSlots(unavailable = false): LiveHudPriceSlots {
  return { rawAmount: null, psa9Amount: null, psa10Amount: null, unavailable };
}

/**
 * Graded and market slots come from the existing slab estimate (PokeTrace on the
 * server). Missing key / off / empty rows stay blank — never invented dollars.
 */
export function liveHudPricesFromSlabEstimate(
  estimate: CardFlowSlabEstimate | null | undefined,
): LiveHudPriceSlots {
  if (!estimate || estimate.source === "none" || !isAllowedPriceSource(estimate.source)) {
    return emptyLiveHudPriceSlots(true);
  }
  const raw =
    estimate.rawRows.find((row) => row.condition === "NM" && row.amount)?.amount ??
    estimate.rawRows.find((row) => row.amount)?.amount ??
    null;
  const psa9 = estimate.rows.find((row) => row.company === "PSA" && row.grade === "9")?.amount ?? null;
  const psa10 = estimate.rows.find((row) => row.company === "PSA" && row.grade === "10")?.amount ?? null;
  const rawAmount = dollarLabel(raw);
  const psa9Amount = dollarLabel(psa9);
  const psa10Amount = dollarLabel(psa10);
  if (!rawAmount && !psa9Amount && !psa10Amount) return emptyLiveHudPriceSlots(true);
  return { rawAmount, psa9Amount, psa10Amount, unavailable: false };
}

/**
 * HUD prices come only from the current match. Slab/PokeTrace amounts fill Raw
 * and PSA slots. A finished empty lookup is unavailable, never a made-up number.
 */
export function liveHudPricesFromMatch(match: LiveHudPriceMatch | null | undefined): LiveHudPriceSlots {
  if (!match) return emptyLiveHudPriceSlots(false);
  if (match.slabSource === "none") return emptyLiveHudPriceSlots(true);
  if (match.slabSource === "poketrace" || match.slabSource === "mock") {
    const rawAmount = dollarLabel(match.rawAmount);
    const psa9Amount = dollarLabel(match.psa9Amount);
    const psa10Amount = dollarLabel(match.psa10Amount);
    if (!rawAmount && !psa9Amount && !psa10Amount) return emptyLiveHudPriceSlots(true);
    return { rawAmount, psa9Amount, psa10Amount, unavailable: false };
  }
  const source = match.referenceSource ?? match.source ?? null;
  if (!isAllowedPriceSource(source)) return emptyLiveHudPriceSlots(false);
  return {
    rawAmount: dollarLabel(match.rawAmount ?? match.estimateAmount),
    psa9Amount: dollarLabel(match.psa9Amount),
    psa10Amount: dollarLabel(match.psa10Amount),
    unavailable: false,
  };
}

/** Local match estimate only. Never read from a livestream page or the live DOM. */
export function liveHudPurchasePriceFromMatch(match: LiveHudPriceMatch | null | undefined): string | null {
  if (!match) return null;
  if (match.slabSource === "poketrace" || match.slabSource === "mock") {
    return dollarAmount(match.rawAmount) ?? dollarAmount(match.estimateAmount);
  }
  const source = match.referenceSource ?? match.source ?? null;
  if (!isAllowedPriceSource(source)) return null;
  return dollarAmount(match.rawAmount ?? match.estimateAmount);
}

export function liveHudQuickSavePayload(input: {
  match?: LiveHudPriceMatch | null;
  purchasePrice?: string | null;
  now?: () => string;
}): { ok: true; payload: LiveHudQuickSavePayload } | { ok: false; reason: "purchase_price_required" } {
  const purchasePrice = dollarAmount(input.purchasePrice) ?? liveHudPurchasePriceFromMatch(input.match);
  if (!purchasePrice) return { ok: false, reason: "purchase_price_required" };
  return {
    ok: true,
    payload: {
      purchasePrice,
      purchasedAt: (input.now ?? (() => new Date().toISOString()))(),
      currency: LOCKED_DISPLAY_CURRENCY,
      shipping: LIVE_HUD_QUICK_SAVE_ZERO,
      tax: LIVE_HUD_QUICK_SAVE_ZERO,
      fees: LIVE_HUD_QUICK_SAVE_ZERO,
      supplies: LIVE_HUD_QUICK_SAVE_ZERO,
    },
  };
}

export function liveHudListingUrl(match: LiveHudListingMatch | null | undefined): string | null {
  if (!match) return null;
  const explicit = match.listingUrl?.trim() ?? "";
  if (/^https:\/\//i.test(explicit) && !/javascript:|placebid|inject/i.test(explicit)) {
    return explicit;
  }
  if (!match.name || !match.number || !match.setName) return null;
  const query = encodeURIComponent(`${match.name} ${match.number} ${match.setName}`);
  return `https://www.tcgplayer.com/search/pokemon/product?q=${query}&view=grid&ProductTypeName=Cards`;
}
