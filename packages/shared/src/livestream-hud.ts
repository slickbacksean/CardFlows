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
