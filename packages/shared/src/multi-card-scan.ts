/**
 * Multi-card still scan (Sean, Oct 18): one photo on the scan screen may contain
 * several raw Pokémon cards. Grading stays one card. Cap and copy live here so
 * the API and the phone share them.
 */
import { ENGLISH_CARDS_ONLY_NOTE, isUnsupportedCardLanguage } from "./english-cards";
import type { CatalogMappingResult, RecognitionDetection } from "./types";

/** Soft cap of cards shown from one photo (Sean: about 9). */
export const MULTI_CARD_SCAN_MAX = 9;

/**
 * When CardSight is off / out of budget / not consented, the local matcher only
 * returns one card. Tell the user to scan one at a time.
 */
export const MULTI_CARD_FALLBACK_SINGLE_NOTE =
  "Scan one card at a time when CardSight isn't available.";

/**
 * CardSight identify: one HTTP request returns every detection in the photo.
 * Billing is per API call (plan "calls"), not per card in the image. Free
 * endpoints are tagged free in the OpenAPI; identify is not. Documented in
 * docs/MULTI_CARD_SCAN.md from api.cardsight.ai/documentation and the
 * cardsightai npm README ("Identify multiple cards in a single image").
 */
export const CARDSIGHT_IDENTIFY_BILLS_PER_REQUEST = true;

export type MultiCardResultState = "pending" | "confirmed" | "skipped" | "rejected";

export interface DetectionCropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MultiCardScanResult {
  /** 0-based index into recognition.detections (after the multi-card cap). */
  index: number;
  state: MultiCardResultState;
  confidence: string | null;
  /** Normalized 0–1 box when the provider returns one; CardSight identify has none today. */
  cropBox: DetectionCropBox | null;
  mapping: CatalogMappingResult;
  /** Non-English prints: show this, allow skip, do not count toward allowance. */
  notice: string | null;
  /** False for unsupported-language detections. */
  countsTowardAllowance: boolean;
  confirmationId: string | null;
}

export function capMultiCardDetections<T>(detections: readonly T[]): T[] {
  return detections.slice(0, MULTI_CARD_SCAN_MAX);
}

export function multiCardCountsTowardAllowance(language: string | null | undefined): boolean {
  return !isUnsupportedCardLanguage(language);
}

export function noticeForDetection(detection: RecognitionDetection): string | null {
  return isUnsupportedCardLanguage(detection.language) ? ENGLISH_CARDS_ONLY_NOTE : null;
}

export function buildMultiCardResults(input: {
  detections: readonly RecognitionDetection[];
  mappings: readonly CatalogMappingResult[];
}): MultiCardScanResult[] {
  const capped = capMultiCardDetections(input.detections);
  return capped.map((detection, index) => {
    const mapping = input.mappings[index];
    if (!mapping) {
      throw new Error(`buildMultiCardResults: missing mapping for detection ${index}`);
    }
    const notice = noticeForDetection(detection);
    return {
      index,
      state: "pending",
      confidence: detection.confidence,
      cropBox: detection.cropBox ?? null,
      mapping,
      notice,
      countsTowardAllowance: multiCardCountsTowardAllowance(detection.language),
      confirmationId: null,
    };
  });
}
