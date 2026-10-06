export type RecognitionProviderName = "cardsight" | "mock" | "obb_phash" | "off";

export type CaptureMethod = "camera_photo" | "manual_scan";

export type RecognitionConfidence = "High" | "Medium" | "Low";

export type MappingConfidence = "High" | "Medium" | "Low" | "Unresolved";

export type MappingStatus =
  | "matched"
  | "ambiguous"
  | "no_match"
  | "provider_conflict"
  | "catalog_unavailable";

export type MatchMethod = "identify" | "manual" | "import" | "correction";

export type PreInventoryState =
  | "scan_captured"
  | "identity_unconfirmed"
  | "identity_confirmed"
  | "identity_rejected";

export type InventoryIntent = "purchased" | "watchlist";

export type ReferencePriceSource = "user_entered" | "later_provider" | "none";

export interface RecognitionField {
  key: string;
  value: string;
}

export interface RecognitionCandidate {
  vendorCardId: string | null;
  name: string | null;
  setName: string | null;
  number: string | null;
  language: string | null;
  fields: RecognitionField[];
  rank: number;
}

export interface RecognitionDetection {
  confidence: RecognitionConfidence;
  matchLevel: string;
  vendorCardId: string | null;
  name: string | null;
  setName: string | null;
  number: string | null;
  language: string | null;
  fields: RecognitionField[];
  candidates: RecognitionCandidate[];
}

export interface RecognitionError {
  code: string;
  httpStatus?: number;
  message: string;
  retryable: boolean;
}

export interface FixtureMeta {
  mocked: true;
  description?: string;
  retryAfterSeconds?: number;
}

export interface CardFlowNormalizedRecognitionResult {
  provider: RecognitionProviderName;
  ok: boolean;
  vendorRequestId: string | null;
  processingTimeMs: number | null;
  detections: RecognitionDetection[];
  error: RecognitionError | null;
  _meta?: FixtureMeta;
}

export interface TcgdexVariants {
  firstEdition: boolean;
  holo: boolean;
  normal: boolean;
  reverse: boolean;
  wPromo: boolean;
}

export interface CatalogImage {
  baseUrl: string;
  source: "tcgdex_assets";
  quality: "high" | "low";
  extension: "webp";
  constructedUrl: string;
  provenance: string;
}

export interface CatalogSetRef {
  id: string;
  name: string;
  logo?: string;
  cardCount?: {
    official: number;
    total: number;
  };
}

export interface CardFlowCanonicalCard {
  cardflowCardId: string | null;
  language: string;
  tcgdexId: string;
  tcgdexSetId: string;
  localId: string;
  name: string;
  category: string;
  rarity: string | null;
  illustrator?: string | null;
  variants: TcgdexVariants;
  selectedVariant: string | null;
  set: CatalogSetRef;
  image: CatalogImage;
  cardsightCardId: string | null;
  catalogFingerprint: string;
  matchMethod?: MatchMethod;
  mappingConfidence?: MappingConfidence;
  mappingStatus?: MappingStatus;
  mintedOn?: "confirm";
}

export interface CatalogError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface CatalogMappingResult {
  provider: "tcgdex" | "mock" | "pokecollector";
  ok: boolean;
  confidence: MappingConfidence;
  status: MappingStatus;
  matchedOn: string[];
  cardflowCardId: string | null;
  tcgdexId: string | null;
  cardsightCardId: string | null;
  canonicalCard: CardFlowCanonicalCard | null;
  candidates: CardFlowCanonicalCard[];
  error: CatalogError | null;
  userConfirmation: {
    required: true;
    crmWriteAllowedBeforeConfirm: false;
    recommendedUx: string;
  };
  lookup: {
    language: string | null;
    setName: string | null;
    resolvedSetId: string | null;
    localId: string | null;
    method: string;
    nameVerified: boolean;
    nameOnlySearchForbiddenForAutoMap: boolean;
    variantHint?: string | null;
  };
  _meta?: FixtureMeta;
}

export interface MaxBuyPreferences {
  targetMarginPct: number;
  feesBufferPct: number;
  conditionAdjustments: Record<string, number> | null;
  defaultCurrency: string;
}

export interface ComputeMaxBuyInput {
  referencePriceAmount: string | number | null;
  condition?: string | null;
  preferences?: Partial<MaxBuyPreferences>;
}

export interface MaxBuyComputation {
  referencePriceAmount: string | null;
  referencePriceCents: number | null;
  referencePriceSource: ReferencePriceSource;
  currency: string;
  currentTargetMarginPct: number;
  currentFeesBufferPct: number;
  currentConditionFactor: number;
  condition: string | null;
  maxBuyAmount: string | null;
  maxBuyAmountCents: number | null;
  isRecomputedGuidance: true;
  display: string;
  disclaimer: string;
}

export interface AllInCostInput {
  purchasePrice: string | number;
  shipping?: string | number | null;
  tax?: string | number | null;
  fees?: string | number | null;
  supplies?: string | number | null;
}

export interface AllInCostComputation {
  purchasePrice: string;
  shipping: string;
  tax: string;
  fees: string;
  supplies: string;
  allInTotal: string;
  allInTotalCents: number;
}

export type RecognitionScenario =
  | "high-confidence"
  | "ambiguous"
  | "no-card"
  | "error"
  | "rate-limit"
  | "no-match";

export const RECOGNITION_SCENARIOS: RecognitionScenario[] = [
  "high-confidence",
  "ambiguous",
  "no-card",
  "error",
  "rate-limit",
  "no-match",
];

export type ListingDraftStatus = "draft" | "ready_for_review";

export type TitleTemplateId =
  | "default_en_raw_single"
  | "en_raw_single_with_condition";

export interface ListingTitleContext {
  name: string;
  setName: string;
  localId: string;
  selectedVariant: string | null;
  condition?: string | null;
  language?: string;
}

export interface ListingCatalogDisplay {
  name: string;
  setName: string;
  localId: string;
  language: string;
  rarity: string | null;
  selectedVariant: string | null;
  image: CatalogImage & { notAUserListingPhoto: true };
}

export interface ListingDraft {
  draftId: string;
  inventoryItemId: string;
  userId: string;
  cardflowCardId: string;
  status: ListingDraftStatus;
  title: string;
  description: string;
  condition: string | null;
  askingPrice: string | null;
  currency: string;
  quantity: 1;
  intendedChannelNote: string;
  notes: string;
  titleTemplateId: TitleTemplateId;
  catalogDisplay: ListingCatalogDisplay;
  publication: {
    published: false;
    marketplace: null;
  };
  aiCopyEnabled: false;
  createdAt: string;
  updatedAt: string;
}

export interface CostToAskSpread {
  allInTotal: string;
  askingPrice: string;
  currency: string;
  spread: string;
  spreadCents: number;
  label: "spread / cost-to-ask gap";
  neverLabelAsProfit: true;
  display: string;
}

export interface ClipboardExport {
  exportKind: "clipboard";
  published: false;
  trigger: "user_tap_copy";
  autoCopyOnSave: false;
  disclaimer: string;
  plainText: string;
  includedFields: Array<
    "title" | "description" | "condition" | "asking_price" | "currency"
  >;
  omittedPrivateNotes: true;
  omittedChannelNote: true;
}

export interface DisclosureAnswers {
  corners?: string | null;
  edges?: string | null;
  surface?: string | null;
  whitening?: string | null;
  centering?: string | null;
}
