/**
 * Runtime checks for the shared domain objects the API returns.
 * Each schema checks the fields the phone relies on; its static type is the
 * existing interface, so TypeScript and the runtime check describe one shape.
 */
import { z } from "zod";
import type { CardFlowGradeEstimate } from "../grade-estimate";
import type { GradeQuotaSnapshot } from "../grade-quota";
import type { GradingReturnedCopy, GradingSubmittedCopy } from "../grading";
import type { CardFlowHealth } from "../health";
import type { InvitedIdentity } from "../identity";
import type { LiveOverlayGuess } from "../live-overlay-guess";
import type { LiveVideoIdentityResult } from "../live-video-identity";
import type { DetectCropResult, PhotoPregradeResult } from "../photo-pregrade";
import type { CardFlowPortfolioSummary, CardFlowPriceEstimate } from "../pricing";
import type { CardFlowSlabEstimate } from "../slab-pricing";
import type {
  CardFlowCanonicalCard,
  ClipboardExport,
  CostToAskSpread,
  ListingDraft,
  MaxBuyPreferences,
} from "../types";
import { typed } from "./core";

const str = z.string();
const nstr = z.string().nullable();
const num = z.number();
const nnum = z.number().nullable();

export const CanonicalCardSchema = typed<CardFlowCanonicalCard>(
  z.looseObject({
    cardflowCardId: nstr,
    language: str,
    tcgdexId: str,
    localId: str,
    name: str,
    set: z.looseObject({ name: str }),
    image: z.looseObject({}),
    variants: z.looseObject({}),
    selectedVariant: nstr.optional(),
  }),
);

export const InvitedIdentitySchema = typed<InvitedIdentity>(
  z.looseObject({ userId: str, label: str }),
);

export const MaxBuyPreferencesSchema = typed<MaxBuyPreferences>(
  z.looseObject({
    targetMarginPct: num,
    feesBufferPct: num,
    conditionAdjustments: z.record(z.string(), num).nullable(),
    defaultCurrency: str,
  }),
);

export const GradeQuotaSnapshotSchema = typed<GradeQuotaSnapshot>(
  z.looseObject({
    plan: z.enum(["free", "premium"]),
    month: str,
    monthlyLimit: num,
    usedThisMonth: num,
    remainingMonthly: num,
    extraCredits: num,
    remainingGrades: num,
    resetsAt: str,
    iapEnabled: z.boolean(),
    fullGrade: z.looseObject({ monthlyLimit: num, usedThisMonth: num, remaining: num }).optional(),
  }),
);

export const PriceEstimateSchema = typed<CardFlowPriceEstimate>(
  z.looseObject({
    tcgdexId: str,
    currency: z.literal("USD"),
    amountCents: nnum,
    amount: nstr,
    source: z.unknown(),
    label: str,
    notAMarket: z.literal(true),
    notABid: z.literal(true),
    display: str,
    disclaimer: str,
  }),
);

export const PortfolioSummarySchema = typed<CardFlowPortfolioSummary>(
  z.looseObject({
    currency: z.literal("USD"),
    amountCents: nnum,
    amount: nstr,
    label: str,
    notAMarket: z.literal(true),
    notABid: z.literal(true),
    display: str,
    disclaimer: str,
  }),
);

export const SlabEstimateSchema = typed<CardFlowSlabEstimate>(
  z.looseObject({
    tcgdexId: str,
    currency: z.literal("USD"),
    rawRows: z.array(z.unknown()),
    rows: z.array(z.unknown()),
    topAmountCents: nnum,
    topAmount: nstr,
    gradedTiers: z.array(z.unknown()),
    label: str,
    notAMarket: z.literal(true),
    notABid: z.literal(true),
    display: str,
  }),
);

export const GradeEstimateSchema = typed<CardFlowGradeEstimate>(
  z.looseObject({
    overall: nnum,
    display: str,
    confidence: z.unknown(),
    subgrades: z.array(z.unknown()),
    usedBack: z.boolean(),
    label: str,
    notACert: z.literal(true),
    disclaimer: str,
    mathTrace: z.array(str),
  }),
);

const side = z.enum(["front", "back"]);

/** POST /v1/grade/extra (full 14-photo grade). `used` is false: the grader has no input for it yet. */
export const GradeExtraShotResultSchema = z.looseObject({
  ok: z.literal(true),
  side: z.enum(["front", "back"]),
  shot: z.enum(["tilt_a", "tilt_b", "corner_tl", "corner_tr", "corner_br", "corner_bl"]),
  used: z.boolean(),
  stored: z.boolean(),
});

export const DetectCropResultSchema = typed<DetectCropResult>(
  z.discriminatedUnion("status", [
    z.looseObject({
      ok: z.literal(true),
      status: z.literal("found"),
      side,
      crop: z.looseObject({ mimeType: z.literal("image/jpeg"), base64: str }),
      warnings: z.array(str),
      uploadId: str.optional(),
    }),
    z.looseObject({
      ok: z.literal(false),
      status: z.literal("retake"),
      code: z.literal("PHOTO_RETAKE"),
      side,
      reasons: z.array(str),
    }),
    z.looseObject({
      ok: z.literal(false),
      status: z.literal("unavailable"),
      code: z.literal("UNAVAILABLE"),
      side,
      message: str,
    }),
  ]),
);

export const PhotoPregradeResultSchema = typed<PhotoPregradeResult>(
  z.discriminatedUnion("status", [
    z.looseObject({
      ok: z.literal(true),
      status: z.literal("scored"),
      label: str,
      disclaimer: str,
      estimate: num,
      subgrades: z.looseObject({}),
      note: str,
      warning: str.optional(),
      quota: GradeQuotaSnapshotSchema.optional(),
    }),
    z.looseObject({
      ok: z.literal(false),
      status: z.literal("retake"),
      reasons: z.array(str),
    }),
    z.looseObject({
      ok: z.literal(false),
      status: z.literal("unavailable"),
      message: str,
    }),
    z.looseObject({
      ok: z.literal(false),
      status: z.literal("out_of_grades"),
      message: str,
    }),
  ]),
);

export const LiveOverlayGuessSchema = typed<LiveOverlayGuess>(
  z.looseObject({
    tcgdexId: str,
    name: nstr,
    setName: nstr,
    number: nstr,
    imageUrl: nstr,
    estimateCents: nnum,
    estimateAmount: nstr,
    estimateDisplay: str,
    maxBuyAmount: nstr,
    maxBuyAmountCents: nnum,
    currency: z.literal("USD"),
    notConfirmed: z.literal(true),
    writesInventory: z.literal(false),
  }),
);

export const LiveVideoIdentitySchema = typed<LiveVideoIdentityResult>(
  z.looseObject({
    tcgdexId: nstr,
    confidence: nstr,
    reason: str,
    pipeline: str,
  }),
);

export const GradingSubmittedCopySchema = typed<GradingSubmittedCopy>(
  z.looseObject({
    userId: str,
    inventoryItemId: str,
    name: str,
    localId: nstr,
    imageUrl: nstr,
    condition: nstr,
    pillarAnswers: z.record(z.string(), z.string()),
    serviceLevelNote: str,
    maxBuyAmount: nstr,
    submittedAt: str,
    orderNumber: str,
    company: str,
    status: str,
    estimateJson: nstr,
  }),
);

export const GradingReturnedCopySchema = typed<GradingReturnedCopy>(
  z.looseObject({
    userId: str,
    inventoryItemId: str,
    name: str,
    localId: nstr,
    imageUrl: nstr,
    certNumber: str,
    returnedGrade: str,
    returnedAt: str,
  }),
);

export const ListingDraftSchema = typed<ListingDraft>(
  z.looseObject({
    draftId: str,
    inventoryItemId: str,
    cardflowCardId: str,
    status: str,
    title: str,
    description: str,
    condition: nstr,
    askingPrice: nstr,
    currency: str,
    intendedChannelNote: str,
    notes: str,
    titleTemplateId: str,
    publication: z.looseObject({ published: z.literal(false) }),
    aiCopyEnabled: z.literal(false),
    createdAt: str,
    updatedAt: str,
  }),
);

export const CostToAskSchema = typed<CostToAskSpread>(
  z.looseObject({
    allInTotal: str,
    askingPrice: str,
    currency: str,
    spread: str,
    spreadCents: num,
    neverLabelAsProfit: z.literal(true),
    display: str,
  }),
);

export const ClipboardExportSchema = typed<ClipboardExport>(
  z.looseObject({
    exportKind: z.literal("clipboard"),
    published: z.literal(false),
    disclaimer: str,
    plainText: str,
    includedFields: z.array(str),
  }),
);

export const HealthSchema = typed<CardFlowHealth>(
  z.looseObject({
    ok: z.boolean(),
    service: z.literal("cardflow-api"),
    mock: z.boolean(),
    mockProviders: z.array(z.unknown()),
    catalog: z.unknown(),
    recognition: z.unknown(),
    gradeEstimate: z.unknown(),
    slabPricing: z.unknown(),
  }),
);
