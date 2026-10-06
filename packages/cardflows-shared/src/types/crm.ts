import type {
  CardFlowCanonicalCard,
  CardFlowNormalizedMappingResult,
  MappingConfidence,
  MappingStatus,
  SelectedVariant,
  TcgdexLanguage,
} from './catalog.js';
import type { CardFlowNormalizedRecognitionResult } from './recognition.js';
import type { MatchLevel, RecognitionConfidence } from './recognition.js';
import type { ReferencePriceSource } from './max-buy.js';

export type PreInventoryState =
  | 'identity_unconfirmed'
  | 'identity_confirmed'
  | 'identity_rejected';

export type CaptureMethod = 'camera_photo' | 'photo_library';

export type MatchMethod = 'identify' | 'manual' | 'correction';

export interface CrmScanImage {
  storageRef: string;
  source: 'user_capture';
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  provenance: string;
}

export interface CrmScanRecognitionSummary {
  provider: 'mock' | 'cardsight';
  ok: boolean;
  vendorRequestId: string | null;
  processingTimeMs: number | null;
  confidence: RecognitionConfidence | null;
  matchLevel: MatchLevel;
  cardsightCardId: string | null;
  name: string | null;
  setName: string | null;
  number: string | null;
  language: string | null;
}

export interface CrmScanMappingSummary {
  confidence: MappingConfidence;
  status: MappingStatus;
  matchedOn: Array<'language' | 'set' | 'localId' | 'name' | 'variant' | 'tcgdexId'>;
  tcgdexId: string | null;
  proposedCardflowCardId: null;
  canonicalWriteAllowed: false;
  crmWriteAllowedBeforeConfirm: false;
}

export interface CrmScan {
  scanId: string;
  userId: string;
  capturedAt: string;
  captureMethod: CaptureMethod;
  preInventoryState: PreInventoryState;
  cardflowCardId: string | null;
  inventoryItemId: null;
  image: CrmScanImage;
  recognition: CrmScanRecognitionSummary;
  mapping: CrmScanMappingSummary;
  recognitionResult: CardFlowNormalizedRecognitionResult;
  mappingResult: CardFlowNormalizedMappingResult;
}

export interface CrmConfirmation {
  confirmationId: string;
  scanId: string;
  userId: string;
  confirmedAt: string;
  cardflowCardId: string;
  language: TcgdexLanguage;
  tcgdexId: string;
  cardsightCardId: string | null;
  matchMethod: MatchMethod;
  selectedVariant: SelectedVariant | null;
  canonicalCard: CardFlowCanonicalCard;
}

export interface PersistedCanonicalCard {
  cardflowCardId: string;
  language: TcgdexLanguage;
  tcgdexId: string;
  tcgdexSetId: string;
  localId: string;
  name: string;
  category: CardFlowCanonicalCard['category'];
  rarity: string | null;
  variants: CardFlowCanonicalCard['variants'];
  image: CardFlowCanonicalCard['image'];
  cardsightCardId: string | null;
  matchMethod: MatchMethod;
  mintedAt: string;
  catalogFingerprint: string;
}

export interface ConfirmScanRequest {
  tcgdexId: string;
  language: TcgdexLanguage;
  matchMethod: MatchMethod;
  selectedVariant?: SelectedVariant | null;
  cardsightCardId?: string | null;
  setName?: string | null;
  localId?: string | null;
}

export type InventoryIntent = 'purchased' | 'watchlist';

export type WorkflowState = 
  | 'watching'
  | 'watchlist_closed'
  | 'acquired'
  | 'drafted';

export interface CrmInventoryItem {
  inventoryItemId: string;
  userId: string;
  cardflowCardId: string;
  confirmationId: string | null;
  scanId: string | null;
  intent: InventoryIntent;
  selectedVariant: SelectedVariant | null;
  condition: string | null;
  quantity: number | null;
  tags: string[];
  locationId: string | null;
  workflowState: WorkflowState;
  targetMaxBuyAmount: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type Currency = 'USD' | 'CAD' | 'EUR' | 'GBP';

export interface CrmPurchase {
  purchaseId: string;
  inventoryItemId: string;
  purchasedAt: string;
  sourceNote: string | null;
  currency: Currency;
  purchasePrice: number;
  shipping: number;
  tax: number;
  fees: number;
  supplies: number;
  allInTotal: number;
  notes: string | null;
  maxBuyAmount: string | null;
  referencePriceAmount: string | null;
  referencePriceSource: ReferencePriceSource | null;
}

export type DraftReadyState = 'incomplete' | 'ready_for_review';

export interface CrmListingDraft {
  draftId: string;
  inventoryItemId: string;
  userId: string;
  title: string | null;
  description: string | null;
  condition: string | null;
  askingPrice: string | null;
  currency: Currency;
  notes: string | null;
  readyState: DraftReadyState;
  createdAt: string;
  updatedAt: string;
}
