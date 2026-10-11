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

/** Collapsed livestream HUD is a circular bubble over the live page, not a strip. */
export const LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE = 72;
export const LIVESTREAM_HUD_BUBBLE_EXPANDED_WIDTH = 304;
export const LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT = 268;
export const LIVESTREAM_HUD_BUBBLE_INSET = 12;

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
}

export function livestreamHudBubbleSize(expanded: boolean): {
  width: number;
  height: number;
} {
  if (expanded) {
    return {
      width: LIVESTREAM_HUD_BUBBLE_EXPANDED_WIDTH,
      height: LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT,
    };
  }
  return {
    width: LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE,
    height: LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE,
  };
}

/** Keep the floating bubble on-screen after a drag or expand. */
export function clampLivestreamHudBubbleOffset(
  input: ClampLivestreamHudBubbleOffsetInput,
): LivestreamHudBubbleOffset {
  const inset = input.inset ?? LIVESTREAM_HUD_BUBBLE_INSET;
  if (input.parentWidth <= 0 || input.parentHeight <= 0) {
    return { x: inset, y: inset };
  }
  const maxX = Math.max(inset, input.parentWidth - input.bubbleWidth - inset);
  const maxY = Math.max(inset, input.parentHeight - input.bubbleHeight - inset);
  return {
    x: Math.min(maxX, Math.max(inset, input.x)),
    y: Math.min(maxY, Math.max(inset, input.y)),
  };
}
