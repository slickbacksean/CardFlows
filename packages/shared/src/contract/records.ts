/** Records the API returns that the phone reads directly (moved from apps/mobile/lib/api.ts). */
import { z } from "zod";
import type { CardFlowCanonicalCard, CaptureMethod, CostToAskSpread, ListingDraft, RecognitionScenario } from "../types";
import type { MultiCardScanResult } from "../multi-card-scan";
import { typed } from "./core";
import { CanonicalCardSchema, CostToAskSchema, ListingDraftSchema } from "./models";

export type ScanImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface ScanRecord {
  scanId: string;
  userId: string;
  captureMethod: CaptureMethod;
  scenario: RecognitionScenario;
  preInventoryState: string;
  cardflowCardId: string | null;
  confirmationId: string | null;
  inventoryItemId: string | null;
  imageStorageRef: string | null;
  imageMimeType: ScanImageMimeType | null;
  recognition: {
    ok: boolean;
    detections: Array<{
      name: string | null;
      setName: string | null;
      number: string | null;
      confidence: string;
      candidates: Array<{
        name: string | null;
        setName: string | null;
        number: string | null;
        vendorCardId: string | null;
      }>;
    }>;
    error: { code: string; message: string; retryable: boolean } | null;
  };
  mapping: {
    ok: boolean;
    confidence: string;
    status: string;
    tcgdexId: string | null;
    cardflowCardId: string | null;
    matchedOn: string[];
    canonicalCard: CardFlowCanonicalCard | null;
    candidates: CardFlowCanonicalCard[];
    userConfirmation: { recommendedUx: string };
    error: { message: string } | null;
  };
  cardResults?: MultiCardScanResult[];
  scanHint?: string | null;
}

export const ScanRecordSchema = typed<ScanRecord>(
  z.looseObject({
    scanId: z.string(),
    userId: z.string(),
    captureMethod: z.string(),
    scenario: z.string(),
    cardflowCardId: z.string().nullable(),
    confirmationId: z.string().nullable(),
    imageStorageRef: z.string().nullable().optional(),
    recognition: z.looseObject({ ok: z.boolean(), detections: z.array(z.unknown()) }),
    mapping: z.looseObject({
      ok: z.boolean(),
      status: z.string(),
      canonicalCard: CanonicalCardSchema.nullable(),
      candidates: z.array(CanonicalCardSchema),
    }),
    cardResults: z.array(z.unknown()).optional(),
    scanHint: z.string().nullable().optional(),
  }),
);

export interface ConfirmationRecord {
  confirmationId: string;
  scanId: string;
  cardflowCardId: string;
  tcgdexId: string;
  selectedVariant: string | null;
  matchMethod: string;
}

export const ConfirmationRecordSchema = typed<ConfirmationRecord>(
  z.looseObject({
    confirmationId: z.string(),
    scanId: z.string(),
    cardflowCardId: z.string(),
    tcgdexId: z.string(),
    selectedVariant: z.string().nullable(),
  }),
);

export interface InventoryItem {
  inventoryItemId: string;
  userId: string;
  cardflowCardId: string;
  scanId?: string | null;
  imageStorageRef?: string | null;
  gradePhotos?: { front: boolean; back: boolean } | null;
  intent: "purchased" | "watchlist";
  workflowState: string;
  quantity: number | null;
  tags: string[];
  selectedVariant?: string | null;
  condition?: string | null;
  referencePriceAmount: string | null;
  targetMaxBuyAmount: string | null;
  purchase: {
    costBasis: { allInTotal: string | null; purchasePrice: string | null };
    maxBuy: { maxBuyAmount: string | null; display: string };
  } | null;
  card?: {
    name: string;
    setName: string;
    localId: string;
    tcgdexId: string;
    language?: string;
    imageUrl?: string | null;
  } | null;
  draft?: { draftId: string; status: string; title?: string | null } | null;
  createdAt: string;
  readOnly?: boolean;
}

export const InventoryItemSchema = typed<InventoryItem>(
  z.looseObject({
    inventoryItemId: z.string(),
    userId: z.string(),
    cardflowCardId: z.string(),
    intent: z.enum(["purchased", "watchlist"]),
    workflowState: z.string(),
    quantity: z.number().nullable(),
    tags: z.array(z.string()),
    referencePriceAmount: z.string().nullable(),
    targetMaxBuyAmount: z.string().nullable(),
    purchase: z
      .looseObject({
        costBasis: z.looseObject({ allInTotal: z.string().nullable() }),
        maxBuy: z.looseObject({ maxBuyAmount: z.string().nullable() }),
      })
      .nullable(),
    card: z
      .looseObject({ name: z.string(), setName: z.string(), localId: z.string(), tcgdexId: z.string() })
      .nullable()
      .optional(),
    draft: z.looseObject({ draftId: z.string(), status: z.string() }).nullable().optional(),
    createdAt: z.string(),
    readOnly: z.boolean().optional(),
  }),
);

export interface DraftView {
  ok: true;
  draft: ListingDraft;
  costToAsk: CostToAskSpread | null;
  allInTotal?: string | null;
  readyForReview: {
    required: string[];
    missing: string[];
    canMark: boolean;
  };
  keywordChips?: string[];
  created?: boolean;
}

export const DraftViewSchema = typed<DraftView>(
  z.looseObject({
    ok: z.literal(true),
    draft: ListingDraftSchema,
    costToAsk: CostToAskSchema.nullable(),
    allInTotal: z.string().nullable().optional(),
    readyForReview: z.looseObject({
      required: z.array(z.string()),
      missing: z.array(z.string()),
      canMark: z.boolean(),
    }),
    keywordChips: z.array(z.string()).optional(),
    created: z.boolean().optional(),
  }),
);

export type PortfolioHistoryRange = "7d" | "30d" | "90d" | "all";

/** One recorded day of the collection estimate. Real snapshots only, never backfilled. */
export interface PortfolioHistoryPoint {
  date: string;
  amountCents: number;
  amount: string;
  pricedCopies: number;
  totalCopies: number;
  recordedAt: string;
}

export const PortfolioHistoryPointSchema = typed<PortfolioHistoryPoint>(
  z.looseObject({
    date: z.string(),
    amountCents: z.number(),
    amount: z.string(),
    pricedCopies: z.number(),
    totalCopies: z.number(),
    recordedAt: z.string(),
  }),
);
