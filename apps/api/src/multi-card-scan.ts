/**
 * Multi-card still-scan helpers (server). Keeps app.ts edits small so we collide
 * less with draft PRs 104 (auth-required) and 105 (CardMagic).
 */
import {
  MULTI_CARD_FALLBACK_SINGLE_NOTE,
  MULTI_CARD_SCAN_MAX,
  buildMultiCardResults,
  capMultiCardDetections,
  mapAllDetectionsToCatalog,
  scanQuotaSnapshot,
  type CardCatalogProvider,
  type CardFlowNormalizedRecognitionResult,
  type CatalogMappingResult,
  type GradePlan,
  type MultiCardScanResult,
} from "@cardflow/shared";

export async function recognitionWithMultiCardMappings(
  recognition: CardFlowNormalizedRecognitionResult,
  catalog: CardCatalogProvider,
): Promise<{
  recognition: CardFlowNormalizedRecognitionResult;
  mapping: CatalogMappingResult;
  mappings: CatalogMappingResult[];
  cardResults: MultiCardScanResult[];
  scanHint: string | null;
}> {
  const cappedDetections = capMultiCardDetections(recognition.detections);
  const capped: CardFlowNormalizedRecognitionResult = {
    ...recognition,
    detections: cappedDetections,
  };
  const mappings = await mapAllDetectionsToCatalog(capped, catalog);
  const cardResults = buildMultiCardResults({ detections: cappedDetections, mappings });
  const mapping = mappings[0] ?? (await mapAllDetectionsToCatalog({ ...capped, detections: [] }, catalog))[0]!;
  const scanHint =
    capped.provider !== "cardsight" && cappedDetections.length <= 1
      ? MULTI_CARD_FALLBACK_SINGLE_NOTE
      : null;
  return { recognition: capped, mapping, mappings, cardResults, scanHint };
}

export function scanQuotaForUser(input: {
  plan: GradePlan;
  confirmEventsThisMonth: number;
  now: Date;
}) {
  return scanQuotaSnapshot({
    plan: input.plan,
    usedThisMonth: input.confirmEventsThisMonth,
    now: input.now,
  });
}

export function monthStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export { MULTI_CARD_SCAN_MAX };
