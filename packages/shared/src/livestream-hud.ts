/** Unmodified [HUDS](https://github.com/rse/huds) overlay id. Do not vendor HUDS source. */
export const LIVESTREAM_HUD_ID = "overlay" as const;

export const LIVESTREAM_HUD_DEFAULT_PORT = 9999;

export const LIVESTREAM_INAPP_BROWSER = "capgo_inappbrowser" as const;

export const LIVESTREAM_HUD_SCANNER_EVENT = "scanner" as const;
export const LIVESTREAM_HUD_IDENTITY_EVENT = "identity" as const;

export interface LivestreamHudScannerPayload {
  on: boolean;
}

export interface LivestreamHudIdentityPayload {
  tcgdexId: string | null;
  name?: string | null;
  setName?: string | null;
  number?: string | null;
  imageUrl?: string | null;
  estimateAmount?: string | null;
  maxBuyAmount?: string | null;
  rawAmount?: string | null;
  psa9Amount?: string | null;
  psa10Amount?: string | null;
  confidence?: string | null;
}

export function livestreamHudPagePath(hudId: string = LIVESTREAM_HUD_ID): string {
  return `/${hudId}/`;
}

export function livestreamHudEventPath(
  eventName: string,
  hudId: string = LIVESTREAM_HUD_ID,
): string {
  return `/${hudId}/event/${eventName}`;
}

export function defaultLivestreamHudOrigin(platformOs: string): string {
  if (platformOs === "android") return `http://10.0.2.2:${LIVESTREAM_HUD_DEFAULT_PORT}`;
  return `http://127.0.0.1:${LIVESTREAM_HUD_DEFAULT_PORT}`;
}

/** WebView allow-list for the HUD page. One origin, matching the page URL. */
export function livestreamHudOriginWhitelist(pageUrl: string): string[] {
  const match = /^(https?:\/\/[^/?#]+)/i.exec(pageUrl.trim());
  return match?.[1] ? [match[1]] : [];
}

export {
  LIVE_HUD_ALLOWED_PRICE_SOURCES,
  LIVE_HUD_QUICK_SAVE_ZERO,
  LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE,
  LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT,
  LIVESTREAM_HUD_BUBBLE_EXPANDED_WIDTH,
  LIVESTREAM_HUD_BUBBLE_HEIGHT,
  LIVESTREAM_HUD_BUBBLE_INSET,
  LIVESTREAM_HUD_BUBBLE_WIDTH,
  LIVESTREAM_HUD_POSITION_KEY,
  clampLivestreamHudBubbleOffset,
  defaultLivestreamHudSavedPosition,
  liveHudListingUrl,
  liveHudPricesFromMatch,
  liveHudPurchasePriceFromMatch,
  liveHudQuickSavePayload,
  livestreamHudBubbleSize,
  livestreamHudBubbleWidth,
  livestreamHudOffsetFromSaved,
  parseLivestreamHudPosition,
  serializeLivestreamHudPosition,
  snapLivestreamHudBubbleOffset,
} from "./livestream-hud-bubble";
export type {
  ClampLivestreamHudBubbleOffsetInput,
  LiveHudListingMatch,
  LiveHudPriceMatch,
  LiveHudPriceSlots,
  LiveHudQuickSavePayload,
  LivestreamHudBubbleOffset,
  LivestreamHudSavedPosition,
  LivestreamHudSnapEdge,
  SnapLivestreamHudBubbleOffsetResult,
} from "./livestream-hud-bubble";
