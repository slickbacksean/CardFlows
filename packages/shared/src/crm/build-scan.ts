import type { CardFlowNormalizedMappingResult } from '../types/catalog.js';
import type { CardFlowNormalizedRecognitionResult } from '../types/recognition.js';
import type { RecognitionDetection } from '../types/recognition.js';
import type { CaptureMethod, CrmScan, CrmScanMappingSummary, CrmScanRecognitionSummary } from '../types/crm.js';

function primaryDetection(result: CardFlowNormalizedRecognitionResult): RecognitionDetection | null {
  return result.detections[0] ?? null;
}

function buildRecognitionSummary(
  result: CardFlowNormalizedRecognitionResult
): CrmScanRecognitionSummary {
  const detection = primaryDetection(result);
  return {
    provider: result.provider,
    ok: result.ok,
    vendorRequestId: result.vendorRequestId,
    processingTimeMs: result.processingTimeMs,
    confidence: detection?.confidence ?? null,
    matchLevel: detection?.matchLevel ?? 'none',
    cardsightCardId: detection?.vendorCardId ?? null,
    name: detection?.name ?? null,
    setName: detection?.setName ?? null,
    number: detection?.number ?? null,
    language: detection?.language ?? null,
  };
}

function buildMappingSummary(mapping: CardFlowNormalizedMappingResult): CrmScanMappingSummary {
  return {
    confidence: mapping.confidence,
    status: mapping.status,
    matchedOn: mapping.matchedOn,
    tcgdexId: mapping.tcgdexId,
    proposedCardflowCardId: null,
    canonicalWriteAllowed: false,
    crmWriteAllowedBeforeConfirm: false,
  };
}

/** Strip preview cardflow_card_id from mapping — mint only on Confirm. */
export function stripPreviewCardflowId(
  mapping: CardFlowNormalizedMappingResult
): CardFlowNormalizedMappingResult {
  const stripCard = (card: CardFlowNormalizedMappingResult['canonicalCard']) =>
    card ? { ...card, cardflowCardId: null } : null;

  return {
    ...mapping,
    cardflowCardId: null,
    canonicalCard: stripCard(mapping.canonicalCard),
    candidates: mapping.candidates.map((candidate) => ({
      ...candidate,
      cardflowCardId: null,
    })),
  };
}

export function buildCrmScan(input: {
  scanId: string;
  userId: string;
  captureMethod: CaptureMethod;
  mimeType: CrmScan['image']['mimeType'];
  recognitionResult: CardFlowNormalizedRecognitionResult;
  mappingResult: CardFlowNormalizedMappingResult;
}): CrmScan {
  const mappingResult = stripPreviewCardflowId(input.mappingResult);

  return {
    scanId: input.scanId,
    userId: input.userId,
    capturedAt: new Date().toISOString(),
    captureMethod: input.captureMethod,
    preInventoryState: 'identity_unconfirmed',
    cardflowCardId: null,
    inventoryItemId: null,
    image: {
      storageRef: `users/${input.userId}/scans/${input.scanId}.jpg`,
      source: 'user_capture',
      mimeType: input.mimeType,
      provenance:
        'User still image captured in CardFlow. Not TCGdex catalog art. Not a CardSight asset.',
    },
    recognition: buildRecognitionSummary(input.recognitionResult),
    mapping: buildMappingSummary(mappingResult),
    recognitionResult: input.recognitionResult,
    mappingResult,
  };
}
