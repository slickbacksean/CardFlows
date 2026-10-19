/**
 * Livestream HUD price lookup (P1).
 *
 * Default: on-demand GET /v1/livestream/guesses/:id with a ~10 min in-memory
 * cache. No bulk TCGplayer download.
 *
 * Bulk snapshot (EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_PRICE_SNAPSHOT=1): gated off
 * by default — TCGplayer licensing for on-device caching is under Policy review.
 *
 * Optional link-out: "See prices on TCGplayer" can replace the in-app estimate.
 */
import {
  LIVESTREAM_TCGPLAYER_LINK_COPY,
  createLivestreamPriceCache,
  livestreamPriceSnapshotEnabled,
  tcgplayerPokemonSearchUrl,
  type LiveOverlayGuess,
  type RecognitionConfidence,
} from "@cardflow/shared";
import { getLiveOverlayGuess } from "./api";

const guessCache = createLivestreamPriceCache<LiveOverlayGuess>();

export { LIVESTREAM_TCGPLAYER_LINK_COPY };

/** True only when the bulk snapshot flag is explicitly on (default off). */
export function isLivestreamPriceSnapshotEnabled(): boolean {
  return livestreamPriceSnapshotEnabled(process.env as Record<string, string | undefined>);
}

/**
 * Fetch a livestream guess/price. Uses the short in-memory cache.
 * When the bulk snapshot flag is on, still falls back to on-demand until a
 * Policy-cleared snapshot builder ships (no bulk download in this PR).
 */
export async function getCachedLiveOverlayGuess(
  tcgdexId: string,
  confidence?: RecognitionConfidence | null,
): Promise<LiveOverlayGuess> {
  const cached = guessCache.get(tcgdexId);
  if (cached) return cached;
  const started = globalThis.performance?.now?.() ?? Date.now();
  const response = await getLiveOverlayGuess(tcgdexId, confidence);
  const elapsed = (globalThis.performance?.now?.() ?? Date.now()) - started;
  if (__DEV__) {
    console.info(`[livestream-timing] ${JSON.stringify({ stages: { price: elapsed }, outcome: "accepted" })}`);
  }
  guessCache.set(tcgdexId, response.guess);
  return response.guess;
}

export function clearLivestreamPriceCache(): void {
  guessCache.clear();
}

/** Public TCGplayer search URL for the optional link-out mode. */
export function livestreamTcgplayerLink(guess: {
  name?: string | null;
  number?: string | null;
  setName?: string | null;
}): { label: typeof LIVESTREAM_TCGPLAYER_LINK_COPY; url: string } {
  return {
    label: LIVESTREAM_TCGPLAYER_LINK_COPY,
    url: tcgplayerPokemonSearchUrl({
      name: guess.name,
      number: guess.number,
      setName: guess.setName,
    }),
  };
}

/**
 * When true, the HUD prefers the TCGplayer link-out over showing an estimate.
 * Off unless EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TCGPLAYER_LINK=1.
 */
export function livestreamTcgplayerLinkPreferred(): boolean {
  const raw = process.env.EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TCGPLAYER_LINK?.trim() ?? "";
  return raw === "1" || raw.toLowerCase() === "true";
}
