import { computeMaxBuy } from "./max-buy";
import { normalizeLiveVideoTcgdexId, type LiveVideoIdentityResult } from "./live-video-identity";
import {
  PRICE_ESTIMATE_REFERENCE_SOURCE,
  emptyPriceEstimate,
  type CardFlowPriceEstimate,
} from "./pricing";
import type { TcgdexCard } from "./catalog";
import type { MaxBuyPreferences, RecognitionConfidence } from "./types";

/** Ephemeral overlay reference. Never persisted on CRM copies. */
export const LIVE_OVERLAY_REFERENCE_SOURCE = PRICE_ESTIMATE_REFERENCE_SOURCE;

export interface LiveOverlayGuess {
  tcgdexId: string;
  name: string | null;
  setName: string | null;
  number: string | null;
  imageUrl: string | null;
  estimateCents: number | null;
  estimateAmount: string | null;
  estimateDisplay: string;
  maxBuyAmount: string | null;
  maxBuyAmountCents: number | null;
  confidence: RecognitionConfidence | null;
  referenceSource: typeof LIVE_OVERLAY_REFERENCE_SOURCE | "none";
  currency: "USD";
  notConfirmed: true;
  writesInventory: false;
}

export interface LiveOverlayGuessInput {
  tcgdexId: string;
  confidence?: RecognitionConfidence | null;
  catalogCard?: TcgdexCard | null;
  estimate?: CardFlowPriceEstimate | null;
  preferences?: Partial<MaxBuyPreferences>;
}

export function isStableLiveIdentity(
  result: LiveVideoIdentityResult | null | undefined,
): result is LiveVideoIdentityResult & { tcgdexId: string } {
  return Boolean(result && result.reason === "identified" && result.tcgdexId);
}

function constructedArtUrl(imageBaseUrl: string | null | undefined): string | null {
  if (!imageBaseUrl) return null;
  return `${imageBaseUrl}/high.webp`;
}

export function emptyLiveOverlayGuess(
  tcgdexId: string,
  confidence: RecognitionConfidence | null = null,
): LiveOverlayGuess {
  return {
    tcgdexId,
    name: null,
    setName: null,
    number: null,
    imageUrl: null,
    estimateCents: null,
    estimateAmount: null,
    estimateDisplay: "No estimate",
    maxBuyAmount: null,
    maxBuyAmountCents: null,
    confidence,
    referenceSource: "none",
    currency: "USD",
    notConfirmed: true,
    writesInventory: false,
  };
}

/**
 * Catalog + USD estimate + display Max Buy for a live `tcgdex_id`.
 * Display-only: no `cardflow_card_id`, no vendor blobs, no inventory write.
 */
export function liveOverlayGuessFromSources(
  input: LiveOverlayGuessInput,
): LiveOverlayGuess | null {
  const tcgdexId = normalizeLiveVideoTcgdexId(input.tcgdexId);
  if (!tcgdexId) return null;

  const catalog = input.catalogCard;
  const catalogMatches = catalog?.id === tcgdexId ? catalog : null;
  const estimate = input.estimate ?? emptyPriceEstimate(tcgdexId);
  const hasEstimate = estimate.amountCents !== null && estimate.amount !== null;
  const maxBuy = computeMaxBuy({
    referencePriceAmount: hasEstimate ? estimate.amount : null,
    preferences: input.preferences,
  });

  return {
    tcgdexId,
    name: catalogMatches?.name ?? null,
    setName: catalogMatches?.set.name ?? null,
    number: catalogMatches?.localId ?? null,
    imageUrl: constructedArtUrl(catalogMatches?.image),
    estimateCents: hasEstimate ? estimate.amountCents : null,
    estimateAmount: hasEstimate ? estimate.amount : null,
    estimateDisplay: estimate.display,
    maxBuyAmount: maxBuy.maxBuyAmount,
    maxBuyAmountCents: maxBuy.maxBuyAmountCents,
    confidence: input.confidence ?? null,
    referenceSource: hasEstimate ? LIVE_OVERLAY_REFERENCE_SOURCE : "none",
    currency: "USD",
    notConfirmed: true,
    writesInventory: false,
  };
}
