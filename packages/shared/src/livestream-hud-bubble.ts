import { PRICE_ESTIMATE_REFERENCE_SOURCE } from "./pricing";

export const LIVESTREAM_HUD_BUBBLE_WIDTH = 288;
export const LIVESTREAM_HUD_BUBBLE_HEIGHT = 84;
export const LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT = 148;
export const LIVESTREAM_HUD_BUBBLE_INSET = 12;
export const LIVESTREAM_HUD_POSITION_KEY = "cardflow.livestream.hud.position";

/** @deprecated Use LIVESTREAM_HUD_BUBBLE_WIDTH. */
export const LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE = LIVESTREAM_HUD_BUBBLE_HEIGHT;
/** @deprecated Use LIVESTREAM_HUD_BUBBLE_WIDTH. */
export const LIVESTREAM_HUD_BUBBLE_EXPANDED_WIDTH = LIVESTREAM_HUD_BUBBLE_WIDTH;

export const LIVE_HUD_ALLOWED_PRICE_SOURCES = [
  PRICE_ESTIMATE_REFERENCE_SOURCE,
  "poketrace",
  "mock",
  "tcgplayer_usd",
] as const;

export type LivestreamHudSnapEdge = "left" | "right";

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
  y: number;
}

export interface LiveHudPriceSlots {
  rawAmount: string | null;
  psa9Amount: string | null;
  psa10Amount: string | null;
}

export interface LiveHudPriceMatch {
  estimateAmount?: string | null;
  rawAmount?: string | null;
  psa9Amount?: string | null;
  psa10Amount?: string | null;
  referenceSource?: string | null;
  source?: string | null;
}

export interface LiveHudListingMatch {
  listingUrl?: string | null;
  name?: string | null;
  number?: string | null;
  setName?: string | null;
}

export function livestreamHudBubbleSize(expanded: boolean): {
  width: number;
  height: number;
} {
  return {
    width: LIVESTREAM_HUD_BUBBLE_WIDTH,
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

/** Keep the floating card on-screen inside the live region and safe area. */
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

/** Spring target after a drag: nearest left/right edge, Y clamped to the safe area. */
export function snapLivestreamHudBubbleOffset(
  input: ClampLivestreamHudBubbleOffsetInput,
): SnapLivestreamHudBubbleOffsetResult {
  const inset = input.inset ?? LIVESTREAM_HUD_BUBBLE_INSET;
  if (input.parentWidth <= 0 || input.parentHeight <= 0) {
    return {
      x: inset + (input.safeLeft ?? 0),
      y: inset + (input.safeTop ?? 0),
      edge: "right",
    };
  }
  const box = safeBox(input);
  const centerX = input.x + input.bubbleWidth / 2;
  const edge: LivestreamHudSnapEdge = centerX < input.parentWidth / 2 ? "left" : "right";
  const x = edge === "left" ? box.minX : box.maxX;
  const y = Math.min(box.maxY, Math.max(box.minY, input.y));
  return { x, y, edge };
}

export function defaultLivestreamHudSavedPosition(): LivestreamHudSavedPosition {
  return { edge: "right", y: LIVESTREAM_HUD_BUBBLE_INSET };
}

export function serializeLivestreamHudPosition(position: LivestreamHudSavedPosition): string {
  return JSON.stringify({ edge: position.edge, y: position.y });
}

export function parseLivestreamHudPosition(raw: string | null | undefined): LivestreamHudSavedPosition | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { edge?: unknown; y?: unknown };
    if (parsed.edge !== "left" && parsed.edge !== "right") return null;
    if (typeof parsed.y !== "number" || !Number.isFinite(parsed.y)) return null;
    return { edge: parsed.edge, y: parsed.y };
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
  const inset = input.inset ?? LIVESTREAM_HUD_BUBBLE_INSET;
  const guessedX = input.position.edge === "left" ? 0 : Math.max(input.parentWidth, inset * 2);
  return snapLivestreamHudBubbleOffset({
    x: guessedX,
    y: input.position.y,
    parentWidth: input.parentWidth,
    parentHeight: input.parentHeight,
    bubbleWidth: input.bubbleWidth,
    bubbleHeight: input.bubbleHeight,
    inset,
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

/**
 * HUD prices come only from the current match. Allowed sources may fill Raw;
 * PSA 9 / PSA 10 stay empty unless the match already has those amounts.
 */
export function liveHudPricesFromMatch(match: LiveHudPriceMatch | null | undefined): LiveHudPriceSlots {
  if (!match) return { rawAmount: null, psa9Amount: null, psa10Amount: null };
  const source = match.referenceSource ?? match.source ?? null;
  const rawFromEstimate =
    isAllowedPriceSource(source) ? dollarLabel(match.rawAmount ?? match.estimateAmount) : null;
  return {
    rawAmount: rawFromEstimate,
    psa9Amount: isAllowedPriceSource(source) ? dollarLabel(match.psa9Amount) : null,
    psa10Amount: isAllowedPriceSource(source) ? dollarLabel(match.psa10Amount) : null,
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
