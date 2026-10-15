import { createHash, timingSafeEqual } from "node:crypto";
import { routePath } from "hono/route";
import { isHot, parsePerfBatch } from "@cardflow/shared";
import { opsMetrics, type OpsMetrics } from "./ops-metrics";
import { parseUserPriceAmount } from "@cardflow/shared";
import {
  cachedPricingProvider,
  createRecognitionCache,
  serverCacheEnabledFromEnv,
} from "./server-cache";
import {
  computeMappingMetrics,
  confirmEventFor,
  mappingMetricsMarkdown,
  weeklyWindow,
  rerankItemsByConfirms,
  scanCorrectionFor,
  suggestVariants,
  type ScanCorrection,
} from "@cardflow/shared";
import {
  canMarkReadyForReview,
  CatalogProviderError,
  CatalogSearchRequestError,
  catalogCardFromMapping,
  CATALOG_UNAVAILABLE_MESSAGE,
  catalogFeatureDisabledError,
  canonicalCardFromTcgdex,
  computeAllInCost,
  computeMaxBuy,
  DETAILS_NEEDED_WORKFLOW_STATE,
  detailsNeededCostBasis,
  isClosedWatchlist,
  isDetailsNeededPurchase,
  isOpenWatchlist,
  isRecentDetailsNeededDuplicate,
  livestreamContextTags,
  WATCHLIST_CLOSED_WORKFLOW_STATE,
  watchlistConversionTags,
  watchlistSourceIdFromTags,
  keywordChips,
  LOCKED_DISPLAY_CURRENCY,
  mapRecognitionToCatalog,
  parseDollarsToCents,
  INVALID_DOLLAR_AMOUNT,
  mockCardRecognitionProvider,
  mockTcgdexCatalogProvider,
  markSubmittedCopyReturned,
  movePurchasedCopyToSubmitted,
  offPricingProvider,
  offSlabPricingProvider,
  emptyPriceEstimate,
  readyForReviewMissing,
  identifyLiveVideo,
  liveOverlayGuessFromSources,
  livestreamIdentifyHealth,
  liveIdentityVisualHealth,
  classifiedTcgdexIdFromLiveVideoMetadata,
  matchRgbPhash,
  normalizeLiveVideoIdentityHash,
  normalizeLiveVideoTcgdexId,
  portfolioSummaryFromUsdCents,
  pricingProviderHealth,
  recognitionHealth,
  catalogHealth,
  GRADE_ENGINE_STILL_RUNNING,
  healthMockProviders,
  healthOk,
  emptyGradeEstimate,
  unavailableGradeEstimate,
  parseStoredGradeEstimate,
  emptySlabEstimate,
  GRADE_IMAGE_MAX_BYTES,
  gradeEstimateHealth,
  isGradeImageMime,
  mockCardGradingProvider,
  NOT_SUBMITTED_CANNOT_RETURN_MESSAGE,
  requireInvitedIdentity,
  searchCatalog,
  slabPricingHealth,
  updateReturnedCopy,
  updateSubmittedCopy,
  WATCHLIST_CANNOT_SUBMIT_MESSAGE,
  type CardCatalogProvider,
  type CardFlowCanonicalCard,
  type CardFlowNormalizedRecognitionResult,
  type CardFlowPriceEstimate,
  type CardPricingProvider,
  type CardRecognitionProvider,
  type CatalogMappingResult,
  type IdentifyCardRequest,
  type InvitedIdentity,
  type CardGradingProvider,
  type SlabPricingProvider,
  type SubmittedCopyPatch,
  type ReturnedCopyPatch,
  type HealthLivestreamIdentify,
  type LiveVideoIdentityPlatform,
  type ObbDetector,
  type PhashIndex,
  type RecognitionConfidence,
  type TcgdexCard,
  type TitleTemplateId,
  createLiveScanTimingLog,
  type LiveScanSample,
  GRADE_QUOTA_COPY,
  calendarMonthKey,
  gradeQuotaSnapshot,
  monthlyLimitForPlan,
  type GradePlan,
  type GradeQuotaSnapshot,
} from "@cardflow/shared";
import { Hono, type Context as HonoContext } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { getConnInfo } from "@hono/node-server/conninfo";
import {
  clientIp,
  detectRateLimitFromEnv,
  globalDailyCapMiddleware,
  globalGradeDailyCapFromEnv,
  gradeRateLimitFromEnv,
  rateLimitMiddleware,
  trustProxyHopsFromEnv,
  type RateLimitConfig,
} from "./rate-limit";
import { APP_API_KEY_HEADER, appApiKeyFromEnv } from "./app-api-key";
import {
  gradeIapFromEnv,
  gradeQuotaEnabledFromEnv,
  premiumUserIdsFromEnv,
} from "./grade-quota-env";
import type { CardgradingEngineStatus, ConcurrencyGate } from "./cardgrading-run";
import type { AppEnv } from "./app-env";
import { contractMiddleware } from "./contract-middleware";
import { corsOriginsFromEnv } from "./cors-env";
import { registerGradeQuotaRoutes } from "./routes/grade-quota";
import { registerPreferenceRoutes } from "./routes/preferences";
import { registerSalesRoutes } from "./routes/sales";
import { recordGradeEstimate, registerGradeHistoryRoutes } from "./routes/grade-history";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";
import { captureApiException } from "./sentry";
import {
  JSON_BODY_MAX_BYTES,
  LIVESTREAM_IDENTIFY_BODY_MAX_BYTES,
  GRADE_ROUTE_BODY_MAX_BYTES,
} from "./request-limits";
import { unmappedSetNameCounts } from "./tcgdex-catalog";
import { createMemoryStore, type InventoryItemRecord, type StorePort } from "./store";
import {
  offPokecollectorAccounts,
  type PokecollectorAccounts,
  type PokecollectorCollectionCopy,
} from "./pokecollector-accounts";
import { SCAN_IMAGE_MAX_BYTES, type ScanImageMimeType } from "./scan-image";
import {
  gradeUploadCache as defaultGradeUploadCache,
  isGradePhotoSide,
  type GradeUploadCache,
} from "./grade-image";
import {
  decideScanIdentify,
  skippedStillIdentifyResult,
  unconfiguredScanIdentifyResult,
} from "./scan-identify";
import { parseScanCreateRequest } from "./scan-request";
import { parseGradeDetectRequest, parseGradeEstimateRequest, type ParsedGradeStill } from "./grade-estimate-request";
import { detectCardForGrade, pregradePhotoPair } from "./grade-photo-flow";
import type { CardgradingRunner } from "./cardgrading-run";
import {
  applyDraftPatch,
  clipboardForDraft,
  createPrefillDraft,
  draftView,
} from "./listing";
import { identityForInviteCode } from "./invited-testers";
import {
  defaultAutoSessionIdentity,
  parseBearerToken,
  resolveDevAutoSession,
} from "./session";
import {
  decodeIdentityCropJpeg,
  normalizeIdentityCropQuad,
  type LiveIdentityOpenclipClient,
} from "./live-identity-openclip";
import { locateLiveVideoCard } from "./live-video-obb";
import { identifyLiveCaptureStill } from "./scan-card-name";
import {
  localDateKey,
  parsePortfolioHistoryRange,
  portfolioHistoryPoint,
  portfolioRangeStartDate,
} from "./portfolio-history";


/** /health never waits more than 3 s on the OpenCV probe (which itself times out at 5 s). */
async function boundedProbe(
  probe: () => Promise<CardgradingEngineStatus>,
): Promise<CardgradingEngineStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Promise<CardgradingEngineStatus>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          ok: false,
          opencv: null,
          numpy: null,
          error: GRADE_ENGINE_STILL_RUNNING,
          checkedAt: new Date().toISOString(),
        }),
      3_000,
    );
  });
  try {
    return await Promise.race([probe(), pending]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isPublicV1Path(method: string, pathName: string): boolean {
  return method === "POST" && pathName === "/v1/sessions";
}

/** Live catalog GET refreshes cache. Outage/flag-off falls back to last mapping snapshot. */
async function catalogCardForConfirm(
  catalog: CardCatalogProvider,
  tcgdexId: string,
  mapping: CatalogMappingResult,
  selectedVariant?: string | null,
): Promise<CardFlowCanonicalCard | null | undefined> {
  const fromMapping = catalogCardFromMapping(mapping, tcgdexId);
  const options = {
    cardsightCardId: fromMapping?.cardsightCardId ?? mapping.cardsightCardId,
    selectedVariant: selectedVariant ?? fromMapping?.selectedVariant ?? null,
  };

  if (catalog.featureDisabled) return fromMapping ?? undefined;

  try {
    const live = await catalog.getCardById(tcgdexId, "en");
    if (live) return canonicalCardFromTcgdex(live, options);
    return fromMapping ?? null;
  } catch (error) {
    if (error instanceof CatalogProviderError) return fromMapping ?? undefined;
    throw error;
  }
}

async function safePriceEstimate(
  pricing: CardPricingProvider,
  tcgdexId: string,
  selectedVariant?: string | null,
): Promise<CardFlowPriceEstimate> {
  try {
    return await pricing.getEstimate({ tcgdexId, language: "en", selectedVariant });
  } catch {
    return emptyPriceEstimate(tcgdexId);
  }
}

function gradeImageInput(
  still: { bytes: Uint8Array; mimeType: string } | null,
) {
  if (!still) return null;
  return {
    byteLength: still.bytes.byteLength,
    mimeType: still.mimeType,
    bytes: still.bytes,
  };
}

function stillFromStored(
  image: { bytes: Uint8Array; mimeType: string } | undefined,
): ParsedGradeStill | null {
  if (!image || !isGradeImageMime(image.mimeType) || image.bytes.byteLength === 0) return null;
  return { bytes: image.bytes, mimeType: image.mimeType };
}

function gradePhotoHash(
  front: { bytes: Uint8Array; mimeType: string },
  back: { bytes: Uint8Array; mimeType: string } | null,
): string {
  const hash = createHash("sha256");
  hash.update(front.mimeType);
  hash.update(front.bytes);
  hash.update("\0");
  if (back) {
    hash.update(back.mimeType);
    hash.update(back.bytes);
  }
  return hash.digest("hex");
}

export interface CreateAppOptions {
  /** When true, a missing Authorization header acts as the default invited user. */
  devAutoSession?: boolean;
  /** Catalog provider. Tests default to mock; local/staging may inject live TCGdex or PokéCollector. */
  catalog?: CardCatalogProvider;
  /** Pricing provider. Tests default to off; local stack may inject PokéCollector. */
  pricing?: CardPricingProvider;
  /** Recognition provider. Tests default to mock; live Capture uses `obb_phash`. */
  recognition?: CardRecognitionProvider;
  /** P1-17: defaults to the process-wide metrics. */
  opsMetrics?: OpsMetrics;
  /** P1-17: bearer token for GET /ops/metrics; defaults to CARD_FLOW_OPS_TOKEN. */
  opsToken?: string | null;
  /** P1-06: manual-search corrections land here (and in the log) for P1-26. */
  scanCorrections?: ScanCorrection[];
  /** P1-03 server caches (pricing + recognition). Defaults to CARD_FLOW_SERVER_CACHE (on). */
  serverCache?: boolean;
  /**
   * When true, identify reads persisted stills (`image_storage_ref`).
   * JSON-only DEV chips stay on mock. Missing/oversize stills never run the model.
   */
  liveIdentifyEnabled?: boolean;
  /**
   * JSON-only scenario chips. Default on outside production so tests and local
   * DEV chips keep mock identify. Production ignores scenario.
   */
  allowDevScenario?: boolean;
  /** Livestream pipeline reported on /health. Not a Settings form. */
  livestreamIdentify?: HealthLivestreamIdentify;
  /**
   * English pHash index for live-video identityHash classify.
   * Missing index / production without weights → unidentified. Never Capture stills.
   */
  livestreamIdentityIndex?: PhashIndex | null;
  /**
   * Optional OpenCLIP sidecar (pokemon-scanner pipeline). Prefer when
   * `identityCropJpeg` is present; pHash remains the fallback. Never Gemini.
   */
  liveIdentityOpenclip?: LiveIdentityOpenclipClient | null;
  /**
   * Debug-only per-stage livestream timing (log lines + GET /v1/livestream/timing).
   * Defaults to `CARD_FLOW_LIVESTREAM_TIMING=1`; off unless set, including production.
   */
  livestreamTiming?: boolean;
  /** YOLO on livestream frames. Empty until the AGPL flag and weights file are both set. */
  liveVideoObb?: () => ObbDetector | null;
  /** Prepare photo-estimate provider. Tests default to mock; flag off injects unavailable. */
  grading?: CardGradingProvider;
  /**
   * Free offline cardgrading runner (vendored detect_and_normalize + grade_card)
   * for the Grade tab. Null/omitted → the photo routes answer "unavailable".
   */
  cardgrading?: CardgradingRunner | null;
  /** Real OpenCV import check for /health. Failed probes are re-run. Omitted → `gradeEngine: null`. */
  gradeEngineProbe?: (() => Promise<CardgradingEngineStatus>) | null;
  /** Grading route rate limit. Defaults to env (`CARD_FLOW_GRADE_RATE_*`); off in tests. */
  gradeRateLimit?: RateLimitConfig | null;
  /** Detect route rate limit (separate bucket). Defaults to env; off in tests. */
  detectRateLimit?: RateLimitConfig | null;
  /** Whole-instance grades per day. Defaults to `CARD_FLOW_GRADE_DAILY_CAP`; off in tests. */
  gradeDailyCap?: number | null;
  /**
   * Per-account monthly pre-grade quota. Defaults to env (`CARD_FLOW_GRADE_QUOTA`);
   * off in tests unless set. Replaces a daily per-account cap.
   */
  gradeQuota?: boolean | null;
  /** In-app purchase flag + stub grant. Defaults to `CARD_FLOW_IAP_*`. */
  gradeIap?: { enabled: boolean; stub: boolean };
  /** Contract checks fail loudly (500) instead of logging. Defaults to on under Vitest. */
  contractStrict?: boolean;
  /** Overlay: these user ids are treated as premium even if the row says free. */
  premiumUserIds?: string[];
  /** Global CardSight identify budget. Defaults to `CARD_FLOW_CARDSIGHT_MONTHLY_BUDGET`; off in tests. */
  cardSightMonthlyBudget?: number | null;
  /**
   * Speed-bump app key (`X-CardFlow-App-Key`). Defaults to `CARD_FLOW_APP_API_KEY`.
   * Null/empty skips the check (tests and local unless configured).
   */
  appApiKey?: string | null;
  /** Grader slot gate; when full, grading routes answer 503 + Retry-After. */
  gradeGate?: Pick<ConcurrencyGate, "isFull"> | null;
  /** Trusted reverse-proxy hops for X-Forwarded-For. Defaults to `CARD_FLOW_TRUST_PROXY_HOPS` (0). */
  trustProxyHops?: number;
  /** Prepare slab comps. Tests default to off. */
  slabPricing?: SlabPricingProvider;
  /** Server-side PokéCollector user directory. Tests default to off. */
  pokecollectorAccounts?: PokecollectorAccounts;
  /** Browser origins. Defaults to `CARD_FLOW_CORS_ORIGINS`. Empty allows no browser origin. */
  corsOrigins?: string[];
  /** Clock for portfolio snapshots. Tests inject fixed days. */
  now?: () => Date;
  /** Detect stills reused by pre-grade so each photo is uploaded once. */
  gradeUploads?: GradeUploadCache;
}

/** Routes write through StorePort. Tests default to memory; local `pnpm dev:api` injects SQLite. */
export function createApp(
  store: StorePort = createMemoryStore(),
  options: CreateAppOptions = {},
) {
  const {
    saveConfirmEvent,
    listConfirmEvents,
    confirmCounts,
    variantCounts,
    deleteUserConfirmEvents,
    saveUserPriceSnapshot,
    listUserPriceSnapshots,
    deleteUserPriceSnapshots,
    confirmScan,
    createSession,
    findCachedCanonicals,
    getCanonical,
    getConfirmation,
    getDraft,
    getDraftForInventoryItem,
    getInventoryItem,
    getPreferences,
    getScan,
    getScanImage,
    getGradeImage,
    deleteUserPhotos,
    getGradeEstimateCache,
    saveGradeEstimateCache,
    getSessionByToken,
    getPokecollectorUserMapping,
    savePokecollectorUserMapping,
    inventoryItemWithLiveGuidance,
    listInventory,
    saveDraft,
    saveInventoryItem,
    deleteInventoryItem,
    saveScan,
    rejectScan,
    saveScanImage,
    saveGradeImage,
    readStoredScanImage,
    setPreferences,
    updateInventoryItem,
    listGradingSubmitted,
    listGradingReturned,
    saveGradingSubmitted,
    saveGradingReturned,
    moveGradingSubmittedToReturned,
    savePortfolioSnapshot,
    listPortfolioSnapshots,
    getGradeAccount,
    setGradePlan,
    addGradeCredits,
    getGradeQuotaUsage,
    consumeGradeQuota,
  } = store;
  const now = options.now ?? (() => new Date());
  const quotaEnabled =
    options.gradeQuota === undefined ? gradeQuotaEnabledFromEnv() : Boolean(options.gradeQuota);
  const gradeIap = options.gradeIap ?? gradeIapFromEnv();
  const premiumUserIds = new Set(options.premiumUserIds ?? premiumUserIdsFromEnv());
  const appApiKey = options.appApiKey === undefined ? appApiKeyFromEnv() : options.appApiKey;
  const devAutoSession = options.devAutoSession ?? resolveDevAutoSession();
  const catalog = options.catalog ?? mockTcgdexCatalogProvider;
  const scanCorrections = options.scanCorrections ?? [];
  const variantSuggestionsFor = (mapping: {
    canonicalCard: CardFlowCanonicalCard | null;
    candidates: CardFlowCanonicalCard[];
  }) => {
    const card = mapping.canonicalCard ?? mapping.candidates[0] ?? null;
    if (!card) return [];
    return suggestVariants({ variants: card.variants, pickedVariantCounts: variantCounts(card.tcgdexId) });
  };
  const recordScanCorrection = (correction: ScanCorrection) => {
    scanCorrections.push(correction);
    if (scanCorrections.length > 1000) scanCorrections.shift();
    if (!process.env.VITEST) console.info(JSON.stringify({ event: "scan_correction", ...correction }));
  };
  const serverCache = options.serverCache ?? serverCacheEnabledFromEnv();
  const basePricing = options.pricing ?? offPricingProvider;
  const pricing = serverCache ? cachedPricingProvider(basePricing) : basePricing;
  const recognitionCache = serverCache ? createRecognitionCache() : null;
  const pokecollectorAccounts = options.pokecollectorAccounts ?? offPokecollectorAccounts;
  const recognitionProvider = options.recognition ?? mockCardRecognitionProvider;
  const gradingProvider = options.grading ?? mockCardGradingProvider;
  const cardgrading = options.cardgrading ?? null;
  const gradeEngineProbe = options.gradeEngineProbe ?? null;
  // One limiter shared by every grading route: per signed-in user and per client IP.
  const trustProxyHops = options.trustProxyHops ?? trustProxyHopsFromEnv();
  type Context = HonoContext<AppEnv>;
  const socketAddress = (c: Context) => {
    try {
      return getConnInfo(c).remote.address ?? undefined;
    } catch {
      return undefined; // app.request() in tests has no socket
    }
  };
  const rateKeys = (c: Context) => {
    const ip = clientIp(c, trustProxyHops, socketAddress);
    // Per-account product cap is monthly (grade quota). Per-IP (and burst) stay here for abuse.
    return [`user:${String(c.get("userId") ?? "anon")}`, ip ? `ip:${ip}` : null];
  };
  const gradeRateLimit = rateLimitMiddleware(
    options.gradeRateLimit === undefined ? gradeRateLimitFromEnv() : options.gradeRateLimit,
    rateKeys,
  );
  const detectRateLimit = rateLimitMiddleware(
    options.detectRateLimit === undefined ? detectRateLimitFromEnv() : options.detectRateLimit,
    rateKeys,
  );
  const gradeDailyCap = globalDailyCapMiddleware(
    options.gradeDailyCap === undefined ? globalGradeDailyCapFromEnv() : options.gradeDailyCap,
  );
  const gradeGate = options.gradeGate ?? null;
  const gradeCapacity = async (c: Context, next: () => Promise<void>) => {
    if (gradeGate?.isFull()) {
      c.header("Retry-After", "15");
      return c.json({ ok: false, error: "CardFlow is busy. Try again in a moment." }, 503);
    }
    return next();
  };
  const gradeBodyTooLarge = (c: Context) =>
    c.json(
      { ok: false, error: `Upload must be ${Math.floor(GRADE_ROUTE_BODY_MAX_BYTES / (1024 * 1024))} MB or smaller` },
      413,
    );
  const slabPricing = options.slabPricing ?? offSlabPricingProvider;
  const liveIdentifyEnabled = options.liveIdentifyEnabled ?? false;
  const allowDevScenario =
    options.allowDevScenario ?? process.env.NODE_ENV !== "production";
  const livestreamIdentify = livestreamIdentifyHealth(
    options.livestreamIdentify ?? "yolo_identity",
  );
  const livestreamIdentityIndex = options.livestreamIdentityIndex ?? null;
  const liveIdentityOpenclip = options.liveIdentityOpenclip ?? null;
  const livestreamTiming =
    options.livestreamTiming ?? process.env.CARD_FLOW_LIVESTREAM_TIMING?.trim() === "1";
  const livestreamTimingLog = createLiveScanTimingLog(500);
  const liveVideoObb = options.liveVideoObb ?? (() => null);
  const gradeUploads = options.gradeUploads ?? defaultGradeUploadCache;

  async function bindPokecollectorUser(identity: InvitedIdentity) {
    try {
      const mapping = await pokecollectorAccounts.upsertInvitedUser(identity);
      if (!mapping) return getPokecollectorUserMapping(identity.userId);
      return savePokecollectorUserMapping(mapping);
    } catch {
      return getPokecollectorUserMapping(identity.userId);
    }
  }

  async function mappedPokecollectorUser(userId: string) {
    const identity = requireInvitedIdentity(userId);
    return getPokecollectorUserMapping(userId) ?? (await bindPokecollectorUser(identity));
  }

  async function collectionCopiesForUser(userId: string) {
    const mapping = await mappedPokecollectorUser(userId);
    if (!mapping) return [] as PokecollectorCollectionCopy[];
    try {
      return await pokecollectorAccounts.listCollection(mapping);
    } catch {
      return [];
    }
  }

  async function wishlistCopiesForUser(userId: string) {
    const mapping = await mappedPokecollectorUser(userId);
    if (!mapping) return [] as PokecollectorCollectionCopy[];
    try {
      return await pokecollectorAccounts.listWishlist(mapping);
    } catch {
      return [];
    }
  }

  function inventoryView(userId: string, item: InventoryItemRecord) {
    const live = inventoryItemWithLiveGuidance(item, getPreferences(userId));
    const card = getCanonical(live.cardflowCardId);
    const draft = getDraftForInventoryItem(userId, live.inventoryItemId);
    const scan = live.scanId ? getScan(userId, live.scanId) : undefined;
    return {
      ...live,
      imageStorageRef: scan?.imageStorageRef ?? null,
      gradePhotos: {
        front: Boolean(getGradeImage(userId, live.inventoryItemId, "front")),
        back: Boolean(getGradeImage(userId, live.inventoryItemId, "back")),
      },
      card: card ? catalogCardSummary(card) : null,
      draft: draft
        ? { draftId: draft.draftId, status: draft.status, title: draft.title }
        : null,
    };
  }

  function catalogCardSummary(card: {
    name: string;
    set: { name: string };
    localId: string;
    tcgdexId: string;
    language: string;
    image: { constructedUrl: string | null };
  }) {
    return {
      name: card.name,
      setName: card.set.name,
      localId: card.localId,
      tcgdexId: card.tcgdexId,
      language: card.language,
      imageUrl: card.image.constructedUrl,
    };
  }

  async function displayCardForTcgdexId(tcgdexId: string) {
    const cached = findCachedCanonicals({ language: "en", tcgdexId })[0];
    if (cached) return catalogCardSummary(cached);
    if (catalog.featureDisabled) return null;
    try {
      const card = await catalog.getCardById(tcgdexId, "en");
      if (!card) return null;
      return catalogCardSummary(canonicalCardFromTcgdex(card));
    } catch {
      return null;
    }
  }

  const REMOTE_ONLY_CREATED_AT = "1970-01-01T00:00:00.000Z";

  interface MergedInventoryCopy {
    item: InventoryItemRecord;
    remoteOnly: boolean;
    tcgdexId: string | null;
  }

  function mergeRemoteCopies(
    userId: string,
    intent: "purchased" | "watchlist",
    remote: PokecollectorCollectionCopy[],
    local: InventoryItemRecord[],
  ): MergedInventoryCopy[] {
    const used = new Set<string>();
    const merged: MergedInventoryCopy[] = [];
    for (const row of remote) {
      if (!row.tcgdexId) continue;
      const match = local.find((item) => {
        if (item.intent !== intent || used.has(item.inventoryItemId)) return false;
        return getCanonical(item.cardflowCardId)?.tcgdexId === row.tcgdexId;
      });
      if (match) {
        used.add(match.inventoryItemId);
        merged.push({
          item: { ...match, quantity: row.quantity },
          remoteOnly: false,
          tcgdexId: row.tcgdexId,
        });
        continue;
      }
      const cached = findCachedCanonicals({ language: "en", tcgdexId: row.tcgdexId })[0];
      merged.push({
        remoteOnly: true,
        tcgdexId: row.tcgdexId,
        item: {
          inventoryItemId: `pc:${intent}:${row.id}`,
          userId,
          cardflowCardId: cached?.cardflowCardId ?? "",
          confirmationId: "",
          scanId: "",
          intent,
          grain: intent === "purchased" ? "physical_copy" : "interest_not_physical_copy",
          selectedVariant: row.selectedVariant,
          condition: row.condition,
          quantity: row.quantity,
          tags: ["raw"],
          workflowState: intent === "purchased" ? "acquired" : "watching",
          referencePriceAmount: null,
          targetMaxBuyAmount: null,
          createdAt: REMOTE_ONLY_CREATED_AT,
          purchase: null,
        },
      });
    }
    return merged;
  }

  async function presentInventoryCopy(userId: string, copy: MergedInventoryCopy) {
    const view = inventoryView(userId, copy.item);
    if (!copy.remoteOnly) return { ...view, readOnly: false };
    const card = view.card ?? (copy.tcgdexId ? await displayCardForTcgdexId(copy.tcgdexId) : null);
    return { ...view, card, draft: null, readOnly: true as const };
  }

  const collectionUnavailable = {
    ok: false,
    error: "Collection is temporarily unavailable. Confirm still works — try again in a moment.",
  };

  async function writePokecollectorCopy(
    userId: string,
    intent: "purchased" | "watchlist",
    input: {
      tcgdexId: string;
      selectedVariant?: string | null;
      condition?: string | null;
      purchasePrice?: string | number | null;
    },
  ) {
    if (pokecollectorAccounts.name === "off") return { ok: true as const };
    try {
      const mapping = await mappedPokecollectorUser(userId);
      if (!mapping) return collectionUnavailable;
      const written =
        intent === "purchased"
          ? await pokecollectorAccounts.addPurchased(mapping, input)
          : await pokecollectorAccounts.addWatchlist(mapping, input);
      if (!written) return collectionUnavailable;
      return { ok: true as const };
    } catch {
      return collectionUnavailable;
    }
  }

  const metrics = options.opsMetrics ?? opsMetrics;
  const opsToken = options.opsToken === undefined ? process.env.CARD_FLOW_OPS_TOKEN : options.opsToken;
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const requestId = resolveRequestId(c.req.header(REQUEST_ID_HEADER));
    c.set("requestId", requestId);
    c.header(REQUEST_ID_HEADER, requestId);
    const startedAt = performance.now();
    await next();
    if (c.req.path !== "/health") {
      metrics.recordRequest(`${c.req.method} ${routePath(c, -1)}`, c.res.status, performance.now() - startedAt);
    }
    if (c.req.path !== "/health" && process.env.VITEST !== "true") {
      console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${requestId}`);
    }
  });
  app.use("*", contractMiddleware(options.contractStrict === undefined ? {} : { strict: options.contractStrict }));
  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? resolveRequestId();
    c.header(REQUEST_ID_HEADER, requestId);
    const message = err instanceof Error ? err.message : "";
    if (err instanceof SyntaxError || /JSON|Unexpected token|Malformed/i.test(message)) {
      return c.json({ ok: false, error: "Invalid request" }, 400);
    }
    captureApiException(err, { requestId });
    console.error(`[${requestId}]`, err);
    return c.json({ ok: false, error: "Something went wrong" }, 500);
  });
  // P1-17: ops metrics, behind a bearer token. 404 when CARD_FLOW_OPS_TOKEN is unset.
  app.get("/ops/metrics", (c) => {
    const expected = opsToken?.trim();
    const given = c.req.header("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (!expected) return c.json({ ok: false, error: "Not found" }, 404);
    if (!given || !timingSafeEqualString(given, expected)) {
      return c.json({ ok: false, error: "Unauthorized" }, 401);
    }
    return c.json({ ok: true, ...metrics.snapshot() });
  });
  const allowedOrigins = new Set(options.corsOrigins ?? corsOriginsFromEnv());
  app.use(
    "/*",
    cors({
      origin: (origin) => (allowedOrigins.has(origin) ? origin : undefined),
      exposeHeaders: [REQUEST_ID_HEADER],
    }),
  );

  const rejectOversized = (c: { json: (body: unknown, status: 413) => Response }) =>
    c.json({ ok: false, error: "Request is too large" }, 413);
  const jsonBodyLimit = bodyLimit({
    maxSize: JSON_BODY_MAX_BYTES,
    onError: rejectOversized,
  });
  const identifyBodyLimit = bodyLimit({
    maxSize: LIVESTREAM_IDENTIFY_BODY_MAX_BYTES,
    onError: rejectOversized,
  });
  app.use("/v1/*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") return next();
    const type = (c.req.header("content-type") ?? "").toLowerCase();
    if (type.includes("multipart/form-data")) return next();
    if (c.req.path === "/v1/livestream/identify") return identifyBodyLimit(c, next);
    return jsonBodyLimit(c, next);
  });

  app.use("/v1/*", async (c, next) => {
    if (!appApiKey) return next();
    const presented = c.req.header(APP_API_KEY_HEADER) ?? "";
    if (presented !== appApiKey) {
      return c.json({ ok: false, error: "CardFlow could not authorize that request." }, 401);
    }
    return next();
  });

  function resolveAccountPlan(userId: string, stored: GradePlan): GradePlan {
    return premiumUserIds.has(userId) ? "premium" : stored;
  }

  function quotaSnapshotFor(userId: string): GradeQuotaSnapshot {
    const at = now();
    const monthKey = calendarMonthKey(at);
    const account = getGradeAccount(userId);
    const plan = resolveAccountPlan(userId, account.plan);
    return gradeQuotaSnapshot({
      plan,
      usedThisMonth: getGradeQuotaUsage(userId, monthKey),
      extraCredits: account.extraCredits,
      iapEnabled: gradeIap.enabled,
      now: at,
    });
  }

  function takeGradeAllowance(userId: string) {
    if (!quotaEnabled) {
      return { ok: true as const, quota: quotaSnapshotFor(userId) };
    }
    const at = now();
    const monthKey = calendarMonthKey(at);
    const account = getGradeAccount(userId);
    const plan = resolveAccountPlan(userId, account.plan);
    const consumed = consumeGradeQuota(userId, {
      monthKey,
      monthlyLimit: monthlyLimitForPlan(plan),
      at: at.toISOString(),
    });
    const quota = gradeQuotaSnapshot({
      plan,
      usedThisMonth: consumed.usedThisMonth,
      extraCredits: consumed.extraCredits,
      iapEnabled: gradeIap.enabled,
      now: at,
    });
    if (!consumed.ok) return { ok: false as const, quota };
    return { ok: true as const, quota };
  }

  function outOfGradesResponse(c: Context, quota: GradeQuotaSnapshot) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((Date.parse(quota.resetsAt) - now().getTime()) / 1000),
    );
    c.header("Retry-After", String(retryAfterSeconds));
    return c.json(
      { ok: false, error: GRADE_QUOTA_COPY.outOfGrades, quota },
      429,
    );
  }

  app.use("/v1/*", async (c, next) => {
    if (isPublicV1Path(c.req.method, c.req.path)) return next();
    const token = parseBearerToken(c.req.header("authorization"));
    if (token) {
      const session = getSessionByToken(token);
      if (!session) return c.json({ ok: false, error: "Unauthorized" }, 401);
      const identity = requireInvitedIdentity(session.userId);
      c.set("userId", identity.userId);
      c.set("identity", identity);
      return next();
    }
    if (devAutoSession) {
      const identity = defaultAutoSessionIdentity();
      c.set("userId", identity.userId);
      c.set("identity", identity);
      return next();
    }
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  });

  app.get("/health", async (c) => {
    const catalogStatus = catalogHealth(catalog.name);
    const recognitionStatus = recognitionHealth(recognitionProvider.name);
    const gradeEstimateStatus = gradeEstimateHealth(gradingProvider.name);
    const slabPricingStatus = slabPricingHealth(slabPricing.name);
    const mockProviders = healthMockProviders({
      catalog: catalogStatus,
      recognition: recognitionStatus,
      gradeEstimate: gradeEstimateStatus,
      slabPricing: slabPricingStatus,
    });
    const gradeEngine = gradeEngineProbe ? await boundedProbe(gradeEngineProbe) : null;
    const ok = healthOk(gradeEngine);
    return c.json(
      {
        ok,
        service: "cardflow-api",
        mock: mockProviders.length > 0,
        mockProviders,
        catalog: catalogStatus,
        recognition: recognitionStatus,
        pricingProvider: pricingProviderHealth(pricing.name),
        livestreamIdentify,
        liveVideoYolo: liveVideoObb() != null,
        liveIdentityVisual: liveIdentityVisualHealth({
          livestreamIdentify,
          openclipConfigured: liveIdentityOpenclip != null,
          phashIndexLoaded: livestreamIdentityIndex != null,
        }),
        gradeEstimate: gradeEstimateStatus,
        // Real `import cv2, numpy` in the grader Python. Failed probes are not cached.
        gradeEngine,
        slabPricing: slabPricingStatus,
      },
      ok ? 200 : 503,
    );
  });

  app.get("/v1/catalog/search", async (c) => {
    try {
      const result = await searchCatalog(
        catalog,
        {
          set: c.req.query("set") ?? c.req.query("setName"),
          number: c.req.query("number") ?? c.req.query("localId"),
          name: c.req.query("name"),
          language: c.req.query("language"),
        },
        {
          cachedCards: findCachedCanonicals({
            language: "en",
            setName: c.req.query("set") ?? c.req.query("setName"),
            localId: c.req.query("number") ?? c.req.query("localId"),
            name: c.req.query("name"),
          }),
        },
      );
      return c.json({ ok: !result.error || result.cards.length > 0, ...result });
    } catch (error) {
      if (error instanceof CatalogSearchRequestError) {
        return c.json({ ok: false, error: error.message }, 400);
      }
      if (error instanceof CatalogProviderError) {
        const status = error.code === "FEATURE_DISABLED" ? 403 : 503;
        return c.json({ ok: false, error: error.toCatalogError() }, status);
      }
      throw error;
    }
  });

  app.get("/v1/catalog/cards/:id", async (c) => {
    try {
      if (catalog.featureDisabled) {
        return c.json({ ok: false, error: catalogFeatureDisabledError() }, 403);
      }
      const card = await catalog.getCardById(c.req.param("id"), "en");
      if (!card) {
        return c.json(
          {
            ok: false,
            error: {
              code: "NOT_FOUND",
              message: "No catalog card for that id. Search manually by English set and number.",
              retryable: false,
            },
          },
          404,
        );
      }
      return c.json({ ok: true, provider: catalog.name, card });
    } catch (error) {
      if (error instanceof CatalogProviderError) {
        const status =
          error.code === "FEATURE_DISABLED" ? 403 : error.code === "NOT_FOUND" ? 404 : 503;
        return c.json({ ok: false, error: error.toCatalogError() }, status);
      }
      throw error;
    }
  });

  /** P1-12: your own reference prices. Works with pricing off. */
  app.get("/v1/pricing/cards/:tcgdexId/yours", (c) => {
    const tcgdexId = c.req.param("tcgdexId").trim();
    if (!tcgdexId) return c.json({ ok: false, error: "tcgdexId is required" }, 400);
    const variantRaw = c.req.query("variant");
    const variant = variantRaw === undefined ? undefined : variantRaw.trim() || null;
    return c.json({ ok: true, snapshots: listUserPriceSnapshots(c.get("userId"), tcgdexId, variant) });
  });

  app.post("/v1/pricing/cards/:tcgdexId/yours", async (c) => {
    const tcgdexId = c.req.param("tcgdexId").trim();
    if (!tcgdexId) return c.json({ ok: false, error: "tcgdexId is required" }, 400);
    const body = await c.req.json<{ amount?: unknown; variant?: string | null }>().catch(() => ({}) as { amount?: unknown; variant?: string | null });
    const amount = parseUserPriceAmount(body.amount);
    if (!amount) return c.json({ ok: false, error: INVALID_DOLLAR_AMOUNT }, 400);
    const snapshot = saveUserPriceSnapshot(c.get("userId"), {
      snapshotId: crypto.randomUUID(),
      tcgdexId,
      variant: typeof body.variant === "string" && body.variant.trim() ? body.variant.trim() : null,
      amount,
      currency: "USD",
      source: "you",
      enteredAt: new Date().toISOString(),
    });
    return c.json({ ok: true, snapshot }, 201);
  });

  // P1-18: sampled on-device timings. Timings only; unknown fields are dropped.
  app.post("/v1/telemetry/perf", async (c) => {
    const batch = parsePerfBatch(await c.req.json().catch(() => null));
    if (!batch) return c.json({ ok: false, error: "Invalid request" }, 400);
    for (const sample of batch.samples) {
      metrics.recordDeviceStage(sample.stage, batch.deviceClass, sample.ms, isHot(batch.thermal));
    }
    return c.json({ ok: true, accepted: batch.samples.length });
  });

  app.get("/v1/pricing/cards/:tcgdexId", async (c) => {
    const tcgdexId = c.req.param("tcgdexId").trim();
    const estimate = await safePriceEstimate(
      pricing,
      tcgdexId,
      c.req.query("variant") ?? c.req.query("selectedVariant"),
    );
    return c.json({
      ok: true,
      provider: pricingProviderHealth(pricing.name),
      estimate,
    });
  });

  app.get("/v1/livestream/guesses/:tcgdexId", async (c) => {
    const tcgdexId = normalizeLiveVideoTcgdexId(c.req.param("tcgdexId"));
    if (!tcgdexId) {
      return c.json({ ok: false, error: "Unknown card id" }, 400);
    }
    const confidenceRaw = c.req.query("confidence");
    const confidence: RecognitionConfidence | null =
      confidenceRaw === "High" || confidenceRaw === "Medium" || confidenceRaw === "Low"
        ? confidenceRaw
        : null;

    let catalogCard: TcgdexCard | null = null;
    try {
      if (!catalog.featureDisabled) {
        catalogCard = await catalog.getCardById(tcgdexId, "en");
      }
    } catch {
      catalogCard = null;
    }

    const estimate = await safePriceEstimate(pricing, tcgdexId);
    const guess = liveOverlayGuessFromSources({
      tcgdexId,
      confidence,
      catalogCard,
      estimate,
      preferences: getPreferences(c.get("userId")),
    });
    if (!guess) {
      return c.json({ ok: false, error: "Unknown card id" }, 400);
    }
    return c.json({ ok: true, guess });
  });

  app.post("/v1/livestream/identify", async (c) => {
    const body = await c.req.json<{
      source?: unknown;
      platform?: unknown;
      cardDetected?: unknown;
      classifiedTcgdexId?: unknown;
      identityHash?: unknown;
      identityCropJpeg?: unknown;
      identityCropQuad?: unknown;
      videoFrameJpeg?: unknown;
      image?: unknown;
      screenshot?: unknown;
    }>();
    if (body.image != null || body.screenshot != null) {
      return c.json({ ok: false, error: "live_video frames only" }, 400);
    }
    if (body.source !== "live_video") {
      return c.json({ ok: false, error: "live_video frames only" }, 400);
    }
    const platform: LiveVideoIdentityPlatform =
      body.platform === "android" || body.platform === "web" ? body.platform : "ios";
    let cardDetected = Boolean(body.cardDetected);
    let identityHash = normalizeLiveVideoIdentityHash(
      typeof body.identityHash === "string" ? body.identityHash : null,
    );
    let identityCropJpeg =
      typeof body.identityCropJpeg === "string" ? body.identityCropJpeg : null;
    let identityCropQuad = normalizeIdentityCropQuad(body.identityCropQuad);
    const yolo = liveVideoObb();
    if (yolo && typeof body.videoFrameJpeg === "string") {
      const located = await locateLiveVideoCard(yolo, body.videoFrameJpeg);
      if (located?.found === false) {
        cardDetected = false;
        identityHash = null;
        identityCropJpeg = null;
        identityCropQuad = null;
      } else if (located?.found) {
        cardDetected = true;
        // Keep a phone crop that already has 4 corners so warp.py can straighten it.
        // Android (no corners) and missed phone detects use the YOLO AABB + OBB quad.
        if (!identityCropJpeg || !identityCropQuad) {
          identityHash = normalizeLiveVideoIdentityHash(located.identityHash);
          identityCropJpeg = located.jpegBase64;
          identityCropQuad = normalizeIdentityCropQuad(located.identityCropQuad);
        }
      }
    }

    const startedAt = performance.now();
    const stages: LiveScanSample["stages"] = {};
    let warped = false;
    let openclipTcgdexId: string | null = null;
    if (livestreamIdentify === "yolo_identity" && liveIdentityOpenclip) {
      const decodeStart = performance.now();
      const crop = decodeIdentityCropJpeg(identityCropJpeg);
      stages.serverDecode = performance.now() - decodeStart;
      if (crop) {
        const sidecarStart = performance.now();
        const match = await liveIdentityOpenclip.matchCropJpeg(crop.bytes, crop.mimeType, {
          quad: identityCropQuad,
        });
        stages.sidecar = performance.now() - sidecarStart;
        if (match?.timings) {
          stages.serverDecode = (stages.serverDecode ?? 0) + (match.timings.decodeMs ?? 0);
          stages.warp = match.timings.warpMs;
          stages.embed = match.timings.embedMs;
          stages.search = match.timings.searchMs;
          stages.orb = match.timings.orbMs;
        }
        warped = match?.warped === true;
        if (match?.accepted && match.tcgdexId) {
          openclipTcgdexId = normalizeLiveVideoTcgdexId(match.tcgdexId);
        }
      }
    }

    const phashStart = performance.now();
    const phashTcgdexId =
      livestreamIdentify === "yolo_identity" && identityHash && livestreamIdentityIndex
        ? (matchRgbPhash(identityHash, livestreamIdentityIndex)[0]?.tcgdexId ?? null)
        : null;
    if (identityHash && livestreamIdentityIndex) stages.phash = performance.now() - phashStart;

    const classifiedTcgdexId =
      openclipTcgdexId ??
      classifiedTcgdexIdFromLiveVideoMetadata({
        classifiedTcgdexId:
          typeof body.classifiedTcgdexId === "string" ? body.classifiedTcgdexId : null,
        identityHash,
        matchedTcgdexId: phashTcgdexId,
      });

    const identity = identifyLiveVideo({
      scannerOn: true,
      platform,
      frame: {
        source: "live_video",
        cardDetected,
        classifiedTcgdexId,
        identityHash,
      },
      classifier: livestreamIdentify === "yolo_identity" ? "yolo_identity" : "none",
    });
    if (!livestreamTiming) return c.json({ ok: true, identity });
    stages.server = performance.now() - startedAt;
    const sample: LiveScanSample = {
      stages,
      outcome: identity.reason === "identified" ? "accepted" : "rejected",
      warped,
    };
    livestreamTimingLog.add(sample);
    console.info(`[livestream-timing] ${JSON.stringify({ ...sample, tcgdexId: identity.tcgdexId })}`);
    return c.json({ ok: true, identity, timing: { stages, warped } });
  });

  /** Debug only: p50/p95 per stage of recent livestream matches. 404 unless timing is on. */
  app.get("/v1/livestream/timing", (c) => {
    if (!livestreamTiming) return c.json({ ok: false, error: "livestream timing is off" }, 404);
    return c.json({ ok: true, summary: livestreamTimingLog.summary() });
  });

  app.get("/v1/cards/:tcgdexId/slab-estimates", async (c) => {
    const tcgdexId = c.req.param("tcgdexId").trim();
    let name: string | undefined;
    let localId: string | undefined;
    let setId: string | undefined;
    let setName: string | undefined;
    try {
      const card = await catalog.getCardById(tcgdexId, "en");
      if (card) {
        name = card.name;
        localId = card.localId;
        setId = card.set.id;
        setName = card.set.name;
      }
    } catch {
      // Catalog miss still returns fail-soft empty rows below.
    }
    try {
      const estimate = await slabPricing.getSlabEstimates({
        tcgdexId,
        language: "en",
        name,
        localId,
        setId,
        setName,
      });
      return c.json({
        ok: true,
        provider: slabPricingHealth(slabPricing.name),
        estimate,
      });
    } catch {
      return c.json({
        ok: true,
        provider: slabPricingHealth(slabPricing.name),
        estimate: emptySlabEstimate(tcgdexId),
      });
    }
  });

  app.get("/v1/grading", (c) => {
    const userId = c.get("userId");
    return c.json({
      ok: true,
      submitted: listGradingSubmitted(userId),
      returned: listGradingReturned(userId),
    });
  });

  app.post("/v1/grading/submitted", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json<{
      intent?: "purchased" | "watchlist";
      inventoryItemId?: string;
      name?: string;
      localId?: string | null;
      imageUrl?: string | null;
      condition?: string | null;
      pillarAnswers?: Record<string, string>;
      serviceLevelNote?: string;
      maxBuyAmount?: string | null;
      estimateJson?: string | null;
      orderNumber?: string;
      company?: string;
      status?: "sent" | "at_grader";
    }>();
    if (!body.inventoryItemId || !body.name) {
      return c.json({ ok: false, error: "inventoryItemId and name are required" }, 400);
    }
    try {
      const next = movePurchasedCopyToSubmitted(listGradingSubmitted(userId), {
        userId,
        intent: body.intent ?? "purchased",
        inventoryItemId: body.inventoryItemId,
        name: body.name,
        localId: body.localId,
        imageUrl: body.imageUrl,
        condition: body.condition,
        pillarAnswers: body.pillarAnswers,
        serviceLevelNote: body.serviceLevelNote,
        maxBuyAmount: body.maxBuyAmount,
        estimateJson: body.estimateJson,
        orderNumber: body.orderNumber,
        company: body.company,
        status: body.status,
      });
      const saved = next.find((copy) => copy.inventoryItemId === body.inventoryItemId);
      if (!saved) return c.json({ ok: false, error: "Could not submit copy" }, 400);
      saveGradingSubmitted(saved);
      return c.json({ ok: true, submitted: listGradingSubmitted(userId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : WATCHLIST_CANNOT_SUBMIT_MESSAGE;
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.patch("/v1/grading/submitted/:inventoryItemId", async (c) => {
    const userId = c.get("userId");
    const inventoryItemId = c.req.param("inventoryItemId");
    const body = await c.req.json<SubmittedCopyPatch>();
    const existing = listGradingSubmitted(userId);
    if (!existing.some((copy) => copy.inventoryItemId === inventoryItemId)) {
      return c.json({ ok: false, error: "Submitted copy not found" }, 404);
    }
    const updated = updateSubmittedCopy(existing, inventoryItemId, body).find(
      (copy) => copy.inventoryItemId === inventoryItemId,
    );
    if (!updated) return c.json({ ok: false, error: "Submitted copy not found" }, 404);
    saveGradingSubmitted(updated);
    return c.json({ ok: true, submitted: listGradingSubmitted(userId) });
  });

  app.post("/v1/grading/returned", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json<{
      inventoryItemId?: string;
      certNumber?: string;
      returnedGrade?: string;
    }>();
    if (!body.inventoryItemId) {
      return c.json({ ok: false, error: "inventoryItemId is required" }, 400);
    }
    try {
      const moved = markSubmittedCopyReturned(
        listGradingSubmitted(userId),
        listGradingReturned(userId),
        {
          inventoryItemId: body.inventoryItemId,
          certNumber: body.certNumber,
          returnedGrade: body.returnedGrade,
        },
      );
      const saved = moved.returned.find((copy) => copy.inventoryItemId === body.inventoryItemId);
      if (!saved) return c.json({ ok: false, error: "Could not mark returned" }, 400);
      moveGradingSubmittedToReturned(saved);
      return c.json({
        ok: true,
        submitted: listGradingSubmitted(userId),
        returned: listGradingReturned(userId),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : NOT_SUBMITTED_CANNOT_RETURN_MESSAGE;
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.patch("/v1/grading/returned/:inventoryItemId", async (c) => {
    const userId = c.get("userId");
    const inventoryItemId = c.req.param("inventoryItemId");
    const body = await c.req.json<ReturnedCopyPatch>();
    const existing = listGradingReturned(userId);
    if (!existing.some((copy) => copy.inventoryItemId === inventoryItemId)) {
      return c.json({ ok: false, error: "Returned copy not found" }, 404);
    }
    const updated = updateReturnedCopy(existing, inventoryItemId, body).find(
      (copy) => copy.inventoryItemId === inventoryItemId,
    );
    if (!updated) return c.json({ ok: false, error: "Returned copy not found" }, 404);
    saveGradingReturned(updated);
    return c.json({ ok: true, returned: listGradingReturned(userId) });
  });

  app.post("/v1/sessions", async (c) => {
    const body = await c.req.json<{ inviteCode?: unknown }>();
    if (typeof body.inviteCode !== "string" || body.inviteCode.trim() === "") {
      return c.json({ ok: false, error: "Unknown invite code" }, 400);
    }
    const identity = identityForInviteCode(body.inviteCode);
    if (!identity) {
      return c.json({ ok: false, error: "Unknown invite code" }, 401);
    }
    const created = createSession(identity.userId);
    await bindPokecollectorUser(created.identity);
    return c.json({
      ok: true,
      token: created.token,
      identity: created.identity,
      invitedUsers: [created.identity],
    });
  });

  app.post("/v1/account/delete", (c) => {
    const userId = c.get("userId");
    const photos = deleteUserPhotos(userId);
    deleteUserConfirmEvents(userId);
    deleteUserPriceSnapshots(userId);
    const staged = gradeUploads.releaseUser(userId);
    const salesDeleted = store.sales.deleteUser(userId);
    const gradeHistoryDeleted = store.gradeHistory.deleteUser(userId);
    return c.json({
      ok: true,
      photosDeleted: photos.deleted + staged,
      salesDeleted,
      gradeHistoryDeleted,
    });
  });

  app.get("/v1/identity", async (c) => {
    await bindPokecollectorUser(c.get("identity"));
    return c.json({
      ok: true,
      identity: c.get("identity"),
      invitedUsers: [c.get("identity")],
    });
  });

  app.patch("/v1/identity", async (c) => {
    const body = await c.req.json<{ inviteCode?: unknown }>();
    if (typeof body.inviteCode !== "string" || body.inviteCode.trim() === "") {
      return c.json({ ok: false, error: "Invite code is required" }, 400);
    }
    const identity = identityForInviteCode(body.inviteCode);
    if (!identity) {
      return c.json({ ok: false, error: "Unknown invite code" }, 401);
    }
    const created = createSession(identity.userId);
    await bindPokecollectorUser(created.identity);
    return c.json({
      ok: true,
      token: created.token,
      identity: created.identity,
      invitedUsers: [created.identity],
    });
  });

  app.get("/v1/collection", async (c) => {
    const items = await collectionCopiesForUser(c.get("userId"));
    return c.json({
      ok: true,
      items: items.map((item) => ({ tcgdexId: item.tcgdexId })),
    });
  });

  app.get("/v1/portfolio", async (c) => {
    const userId = c.get("userId");
    const copies =
      pokecollectorAccounts.name === "off" ? [] : await collectionCopiesForUser(userId);
    let cents = 0;
    let hasEstimate = false;
    let pricedCopies = 0;
    let totalCopies = 0;
    for (const copy of copies) {
      totalCopies += copy.quantity;
      if (!copy.tcgdexId) continue;
      const estimate = await safePriceEstimate(pricing, copy.tcgdexId, copy.selectedVariant);
      if (estimate.amountCents === null) continue;
      cents += estimate.amountCents * copy.quantity;
      pricedCopies += copy.quantity;
      hasEstimate = true;
    }
    const portfolio = portfolioSummaryFromUsdCents(hasEstimate ? cents : null);
    if (portfolio.amountCents !== null) {
      // Real estimate only. No estimate (pricing off/outage) records nothing.
      const recordedAt = now();
      savePortfolioSnapshot(userId, {
        date: localDateKey(recordedAt),
        amountCents: portfolio.amountCents,
        currency: "USD",
        pricedCopies,
        totalCopies,
        recordedAt: recordedAt.toISOString(),
      });
    }
    return c.json({
      ok: true,
      currency: portfolio.currency,
      portfolio,
    });
  });

  /** Recorded daily snapshots of `/v1/portfolio`. Oldest first. Never backfilled. */
  app.get("/v1/portfolio/history", (c) => {
    const range = parsePortfolioHistoryRange(c.req.query("range"));
    if (!range) {
      return c.json({ ok: false, error: "range must be 7d, 30d, 90d, or all" }, 400);
    }
    const userId = c.get("userId");
    const points = listPortfolioSnapshots(userId, portfolioRangeStartDate(range, now())).map(
      portfolioHistoryPoint,
    );
    return c.json({
      ok: true,
      currency: "USD" as const,
      range,
      today: localDateKey(now()),
      points,
    });
  });

  registerPreferenceRoutes(app, { getPreferences, setPreferences });
  registerSalesRoutes(app, {
    sales: store.sales,
    ownsInventoryItem: (userId, inventoryItemId) =>
      getInventoryItem(userId, inventoryItemId)?.intent === "purchased",
  });
  registerGradeHistoryRoutes(app, {
    gradeHistory: store.gradeHistory,
    ownsInventoryItem: (userId, inventoryItemId) =>
      getInventoryItem(userId, inventoryItemId)?.intent === "purchased",
  });

  app.post("/v1/scans", bodyLimit({
      maxSize: SCAN_IMAGE_MAX_BYTES,
      onError: (c) => c.json({ ok: false, error: "Image must be 20 MB or smaller" }, 413),
    }), async (c) => {
      const parsed = await parseScanCreateRequest(c);
      if ("error" in parsed) {
        return c.json({ ok: false, error: parsed.error }, parsed.status);
      }
      const captureMethod = parsed.captureMethod;
      const scenario = parsed.scenario;
      const userId = c.get("userId");
      // P1-10: a replayed offline scan with the same Idempotency-Key returns the first scan.
      const scanIdempotencyKey = c.req.header("idempotency-key")?.trim() || null;
      const scanId = scanIdempotencyKey
        ? scanIdForIdempotency(userId, scanIdempotencyKey)
        : crypto.randomUUID();
      const replayedScan = scanIdempotencyKey ? getScan(userId, scanId) : undefined;
      if (replayedScan) {
        return c.json({ ok: true, scan: replayedScan, variantSuggestions: variantSuggestionsFor(replayedScan.mapping) }, 201);
      }
      let imageStorageRef: string | null = null;
      let imageMimeType: ScanImageMimeType | null = null;
      if (parsed.image) {
        const saved = saveScanImage(scanId, parsed.image);
        imageStorageRef = saved.storageRef;
        imageMimeType = saved.mimeType;
      }
      const storedStill = imageStorageRef
        ? readStoredScanImage(scanId, imageStorageRef)
        : undefined;
      const identify = decideScanIdentify({
        liveIdentifyEnabled,
        allowDevScenario,
        persistedStorageRef: imageStorageRef,
        stored: storedStill,
        scenario,
      });
      let recognition: CardFlowNormalizedRecognitionResult;
      if (identify.action === "unconfigured") {
        recognition = unconfiguredScanIdentifyResult();
      } else if (identify.action === "skip_model") {
        recognition = skippedStillIdentifyResult(identify.reason);
      } else if (identify.action === "live") {
        const identifyRequest: IdentifyCardRequest = {
          image: identify.image,
          mimeType: identify.mimeType,
        };
        const runLive = () =>
          identifyLiveCaptureStill({
            image: identify.image,
            mimeType: identify.mimeType,
            fallback: recognitionProvider,
            openclip: liveIdentityOpenclip,
            catalog,
          });
        recognition = recognitionCache
          ? await recognitionCache.getOrIdentify(
              { bytes: identify.image, mimeType: identify.mimeType },
              recognitionProvider.name,
              runLive,
            )
          : await runLive();
      } else {
        const identifyRequest: IdentifyCardRequest = {
          image: identify.image,
          mimeType: identify.mimeType,
          scenario: identify.scenario,
        };
        const mockProvider =
          liveIdentifyEnabled ? mockCardRecognitionProvider : recognitionProvider;
        recognition = await mockProvider.identifyCard(identifyRequest);
      }
      const mapped = await mapRecognitionToCatalog(recognition, catalog);
      // P1-26: cards users keep confirming move up the candidate list.
      const mapping =
        mapped.candidates.length > 1
          ? {
              ...mapped,
              candidates: rerankItemsByConfirms(
                mapped.candidates,
                (card) => card.tcgdexId,
                confirmCounts(mapped.candidates.map((card) => card.tcgdexId)),
              ),
            }
          : mapped;
      const scan = saveScan({
        scanId,
        userId,
        capturedAt: new Date().toISOString(),
        captureMethod,
        scenario,
        preInventoryState: "scan_captured",
        cardflowCardId: null,
        confirmationId: null,
        inventoryItemId: null,
        imageStorageRef,
        imageMimeType,
        recognition,
        mapping,
      });
      return c.json({ ok: true, scan, variantSuggestions: variantSuggestionsFor(scan.mapping) }, 201);
    },
  );

  app.get("/v1/scans/:scanId/image", (c) => {
    const scan = getScan(c.get("userId"), c.req.param("scanId"));
    if (!scan) return c.json({ ok: false, error: "Scan not found" }, 404);
    const image = getScanImage(c.get("userId"), scan.scanId);
    if (!image) return c.json({ ok: false, error: "Scan image not found" }, 404);
    return new Response(image.bytes, {
      status: 200,
      headers: {
        "Content-Type": image.mimeType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  app.get("/v1/scans/:scanId", (c) => {
    const scan = getScan(c.get("userId"), c.req.param("scanId"));
    if (!scan) return c.json({ ok: false, error: "Scan not found" }, 404);
    return c.json({ ok: true, scan, variantSuggestions: variantSuggestionsFor(scan.mapping) });
  });

  app.post("/v1/scans/:scanId/confirm", async (c) => {
    const scan = getScan(c.get("userId"), c.req.param("scanId"));
    if (!scan) return c.json({ ok: false, error: "Scan not found" }, 404);
    const body = await c.req.json<{
      tcgdexId?: string;
      selectedVariant?: string | null;
      via?: string | null;
    }>();
    if (!body.tcgdexId) {
      return c.json({ ok: false, error: "tcgdexId is required" }, 400);
    }
    try {
      const resolvedCatalog = await catalogCardForConfirm(
        catalog,
        body.tcgdexId,
        scan.mapping,
        body.selectedVariant,
      );
      const cachedCatalog = findCachedCanonicals({
        language: "en",
        tcgdexId: body.tcgdexId,
      })[0];
      if (!resolvedCatalog && !cachedCatalog && resolvedCatalog === undefined) {
        return c.json({ ok: false, error: CATALOG_UNAVAILABLE_MESSAGE }, 503);
      }
      const catalogCard = resolvedCatalog ?? cachedCatalog ?? null;
      if (scan.preInventoryState === "identity_confirmed" && scan.confirmationId) {
        const existing = getConfirmation(c.get("userId"), scan.confirmationId);
        const canonicalCard = existing ? getCanonical(existing.cardflowCardId) : undefined;
        if (existing && canonicalCard) {
          return c.json({
            ok: true,
            scan,
            confirmation: existing,
            canonicalCard,
          });
        }
      }
      const result = confirmScan({
        scan,
        selectedTcgdexId: body.tcgdexId,
        selectedVariant: body.selectedVariant,
        catalogCard,
      });
      const correction = scanCorrectionFor({
        scanId: scan.scanId,
        userId: c.get("userId"),
        via: body.via,
        predictedTcgdexId: scan.mapping.tcgdexId ?? scan.mapping.canonicalCard?.tcgdexId ?? null,
        candidateTcgdexIds: scan.mapping.candidates.map((card) => card.tcgdexId),
        chosenTcgdexId: body.tcgdexId,
        recognitionProvider: scan.mapping.provider,
      });
      if (correction) recordScanCorrection(correction);
      const shown = scan.mapping.candidates.map((card) => card.tcgdexId);
      const predicted = scan.mapping.tcgdexId ?? scan.mapping.canonicalCard?.tcgdexId ?? null;
      saveConfirmEvent(
        confirmEventFor({
          scanId: scan.scanId,
          userId: c.get("userId"),
          via: body.via,
          shownTcgdexIds: shown.length > 0 ? shown : predicted ? [predicted] : [],
          chosenTcgdexId: body.tcgdexId,
          selectedVariant: body.selectedVariant ?? null,
          confidence: scan.mapping.confidence ?? null,
          recognitionProvider: scan.mapping.provider,
        }),
      );
      return c.json({
        ok: true,
        scan: result.scan,
        confirmation: result.confirmation,
        canonicalCard: result.canonicalCard,
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Confirm failed",
        },
        400,
      );
    }
  });

  /** P1-27: weekly mapping-quality report (aggregates only, no user ids). */
  app.get("/v1/metrics/mapping", (c) => {
    const daysRaw = Number(c.req.query("days") ?? 7);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.floor(daysRaw), 1), 90) : 7;
    const window = weeklyWindow(new Date(), days);
    const report = computeMappingMetrics({
      events: listConfirmEvents({ since: window.from }),
      ...window,
      unmappedSetNames: unmappedSetNameCounts(),
    });
    if (c.req.query("format") === "markdown") {
      return c.text(mappingMetricsMarkdown(report), 200, { "content-type": "text/markdown; charset=utf-8" });
    }
    return c.json({ ok: true, report });
  });

  app.post("/v1/scans/:scanId/reject", (c) => {
    const scan = getScan(c.get("userId"), c.req.param("scanId"));
    if (!scan) return c.json({ ok: false, error: "Scan not found" }, 404);
    const rejected = rejectScan(scan);
    if (!rejected) {
      return c.json({ ok: false, error: "Scan is already confirmed" }, 409);
    }
    return c.json({ ok: true, scan: rejected });
  });

  app.get("/v1/cards/:cardflowCardId", (c) => {
    const card = getCanonical(c.req.param("cardflowCardId"));
    if (!card) return c.json({ ok: false, error: "Card not found" }, 404);
    return c.json({ ok: true, canonicalCard: card });
  });

  app.get("/v1/inventory", async (c) => {
    const userId = c.get("userId");
    const local = listInventory(userId).filter((item) => !isClosedWatchlist(item));
    if (pokecollectorAccounts.name === "off") {
      return c.json({
        ok: true,
        items: local.map((item) => ({
          ...inventoryView(
            userId,
            inventoryItemWithLiveGuidance(item, getPreferences(userId)),
          ),
          readOnly: false,
        })),
      });
    }
    const purchased = mergeRemoteCopies(
      userId,
      "purchased",
      await collectionCopiesForUser(userId),
      local,
    );
    const watching = mergeRemoteCopies(
      userId,
      "watchlist",
      await wishlistCopiesForUser(userId),
      local,
    );
    const items = await Promise.all(
      [...purchased, ...watching].map((copy) => presentInventoryCopy(userId, copy)),
    );
    return c.json({ ok: true, items });
  });

  app.get("/v1/inventory/:inventoryItemId", (c) => {
    const userId = c.get("userId");
    const item = getInventoryItem(userId, c.req.param("inventoryItemId"));
    if (!item) return c.json({ ok: false, error: "Inventory item not found" }, 404);
    const live = inventoryItemWithLiveGuidance(item, getPreferences(userId));
    const card = getCanonical(live.cardflowCardId);
    const draft = getDraftForInventoryItem(userId, live.inventoryItemId);
    return c.json({
      ok: true,
      item: live,
      canonicalCard: card ?? null,
      draft: draft ?? null,
    });
  });

  app.delete("/v1/inventory/:inventoryItemId", (c) => {
    const userId = c.get("userId");
    const inventoryItemId = c.req.param("inventoryItemId");
    const item = getInventoryItem(userId, inventoryItemId);
    if (!item) return c.json({ ok: false, error: "Inventory item not found" }, 404);
    if (item.intent !== "purchased" || !isDetailsNeededPurchase(item)) {
      return c.json(
        { ok: false, error: "Only incomplete Purchased copies can be undone" },
        409,
      );
    }
    const sourceWatchlistId = watchlistSourceIdFromTags(item.tags);
    if (!deleteInventoryItem(userId, inventoryItemId)) {
      return c.json({ ok: false, error: "Inventory item not found" }, 404);
    }
    store.sales.delete(userId, inventoryItemId);
    store.gradeHistory.deleteItem(userId, inventoryItemId);
    if (sourceWatchlistId) {
      const watchlist = getInventoryItem(userId, sourceWatchlistId);
      if (watchlist && watchlist.intent === "watchlist") {
        updateInventoryItem(userId, sourceWatchlistId, {
          workflowState: "watching",
          closedAt: null,
        });
      }
    }
    return c.json({ ok: true, deleted: true });
  });


  registerGradeQuotaRoutes(app, {
    quotaSnapshotFor,
    takeGradeAllowance,
    outOfGradesResponse,
    gradeIap,
    setGradePlan,
    addGradeCredits,
    now,
  });

  app.post(
    "/v1/grade/detect",
    detectRateLimit,
    gradeCapacity,
    bodyLimit({
      maxSize: GRADE_ROUTE_BODY_MAX_BYTES,
      onError: gradeBodyTooLarge,
    }),
    async (c) => {
      const parsed = await parseGradeDetectRequest(c);
      if ("error" in parsed) {
        return c.json({ ok: false, error: parsed.error }, parsed.status);
      }
      const result = await detectCardForGrade({
        runner: cardgrading,
        still: parsed.still,
        side: parsed.side,
        captureMeta: parsed.captureMeta ?? null,
      });
      // Retake and unavailable are answers, not transport errors: 200 with ok:false.
      if (!result.ok) return c.json(result);
      const uploadId = gradeUploads.stage(c.get("userId"), parsed.side, parsed.still);
      return c.json({ ...result, uploadId });
    },
  );

  app.post(
    "/v1/grade/pregrade",
    gradeRateLimit,
    gradeCapacity,
    gradeDailyCap,
    bodyLimit({
      maxSize: GRADE_ROUTE_BODY_MAX_BYTES,
      onError: gradeBodyTooLarge,
    }),
    async (c) => {
      const parsed = await parseGradeEstimateRequest(c, {
        userId: c.get("userId"),
        stagedStill: (userId, id, side) => gradeUploads.get(userId, id, side),
      });
      if ("error" in parsed) {
        return c.json({ ok: false, error: parsed.error }, parsed.status);
      }
      if (!parsed.frontImage || !parsed.backImage) {
        return c.json({ ok: false, error: "Front and back photos are required" }, 400);
      }
      const taken = takeGradeAllowance(c.get("userId"));
      if (!taken.ok) return outOfGradesResponse(c, taken.quota);
      const result = await pregradePhotoPair({
        runner: cardgrading,
        front: parsed.frontImage,
        back: parsed.backImage,
        angledFront: parsed.angledFront ?? [],
        captureMeta: parsed.captureMeta ?? null,
      });
      const userId = c.get("userId");
      if (parsed.frontUploadId) gradeUploads.release(userId, parsed.frontUploadId);
      if (parsed.backUploadId) gradeUploads.release(userId, parsed.backUploadId);
      return c.json({ ...result, quota: taken.quota });
    },
  );

  app.post(
    "/v1/inventory/:inventoryItemId/grade-estimate",
    gradeRateLimit,
    gradeCapacity,
    gradeDailyCap,
    bodyLimit({
      maxSize: GRADE_ROUTE_BODY_MAX_BYTES,
      onError: gradeBodyTooLarge,
    }),
    async (c) => {
      const userId = c.get("userId");
      const item = getInventoryItem(userId, c.req.param("inventoryItemId"));
      if (!item) return c.json({ ok: false, error: "Inventory item not found" }, 404);
      if (item.intent !== "purchased") {
        return c.json({ ok: false, error: WATCHLIST_CANNOT_SUBMIT_MESSAGE }, 400);
      }

      const parsed = await parseGradeEstimateRequest(c, {
        userId: c.get("userId"),
        stagedStill: (userId, id, side) => gradeUploads.get(userId, id, side),
      });
      if ("error" in parsed) {
        return c.json({ ok: false, error: parsed.error }, parsed.status);
      }

      const createdAt = now().toISOString();
      if (parsed.frontImage) {
        saveGradeImage(userId, item.inventoryItemId, "front", {
          ...parsed.frontImage,
          createdAt,
        });
      }
      if (parsed.backImage) {
        saveGradeImage(userId, item.inventoryItemId, "back", {
          ...parsed.backImage,
          createdAt,
        });
      }

      const frontImage =
        parsed.frontImage ??
        stillFromStored(getGradeImage(userId, item.inventoryItemId, "front")) ??
        stillFromStored(item.scanId ? getScanImage(userId, item.scanId) : undefined);
      const backImage =
        parsed.backImage ?? stillFromStored(getGradeImage(userId, item.inventoryItemId, "back"));

      const photoHash = frontImage ? gradePhotoHash(frontImage, backImage) : null;
      if (photoHash && !parsed.reestimate) {
        const cached = getGradeEstimateCache(userId, item.inventoryItemId);
        const cachedEstimate =
          cached?.photoHash === photoHash ? parseStoredGradeEstimate(cached.estimateJson) : null;
        // Never serve a cached 0 — that is a retake, not a pre-grade estimate.
        if (cachedEstimate && cachedEstimate.overall != null && cachedEstimate.overall >= 1) {
          if (parsed.frontUploadId) gradeUploads.release(userId, parsed.frontUploadId);
          if (parsed.backUploadId) gradeUploads.release(userId, parsed.backUploadId);
          return c.json({
            ok: true,
            provider: gradeEstimateHealth(gradingProvider.name),
            estimate: cachedEstimate,
            quota: quotaSnapshotFor(userId),
          });
        }
      }

      const taken = takeGradeAllowance(userId);
      if (!taken.ok) return outOfGradesResponse(c, taken.quota);

      let estimate = emptyGradeEstimate();
      try {
        estimate = await gradingProvider.estimateGrade({
          frontImage: gradeImageInput(frontImage),
          backImage: gradeImageInput(backImage),
          mimeType: frontImage?.mimeType,
        });
      } catch {
        // A crashed or timed-out grader is "unavailable", never a silent empty estimate.
        estimate = unavailableGradeEstimate();
      }
      // Cache only a real 1.0–10.0 number. Retake / unavailable / 0 must re-run.
      if (photoHash && estimate.overall != null && estimate.overall >= 1) {
        saveGradeEstimateCache(userId, item.inventoryItemId, {
          photoHash,
          estimateJson: JSON.stringify(estimate),
        });
      }
      // P2-07: every fresh real estimate joins the card's history (cached repeats do not).
      recordGradeEstimate(store.gradeHistory, userId, item.inventoryItemId, estimate, new Date().toISOString());

      if (parsed.frontUploadId) gradeUploads.release(userId, parsed.frontUploadId);
      if (parsed.backUploadId) gradeUploads.release(userId, parsed.backUploadId);
      return c.json({
        ok: true,
        provider: gradeEstimateHealth(gradingProvider.name),
        estimate,
        quota: taken.quota,
      });
    },
  );

  app.get("/v1/inventory/:inventoryItemId/grade-photos/:side", (c) => {
    const userId = c.get("userId");
    const item = getInventoryItem(userId, c.req.param("inventoryItemId"));
    if (!item) return c.json({ ok: false, error: "Inventory item not found" }, 404);
    if (item.intent !== "purchased") {
      return c.json({ ok: false, error: WATCHLIST_CANNOT_SUBMIT_MESSAGE }, 400);
    }
    const side = c.req.param("side");
    if (!isGradePhotoSide(side)) return c.json({ ok: false, error: "Grade photo not found" }, 404);
    const image = getGradeImage(userId, item.inventoryItemId, side);
    if (!image) return c.json({ ok: false, error: "Grade photo not found" }, 404);
    return new Response(image.bytes, {
      status: 200,
      headers: {
        "Content-Type": image.mimeType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  app.post("/v1/inventory/purchased", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json<{
      confirmationId?: string;
      currency?: string;
      purchasePrice?: string | number;
      purchasedAt?: string;
      shipping?: string | number | null;
      tax?: string | number | null;
      fees?: string | number | null;
      supplies?: string | number | null;
      condition?: string | null;
      selectedVariant?: string | null;
      referencePriceAmount?: string | number | null;
      anotherCopy?: boolean;
      detailsNeeded?: boolean;
      platform?: string | null;
      streamUrl?: string | null;
    }>();

    const detailsNeeded = body.detailsNeeded === true;
    const purchasePrice =
      body.purchasePrice === undefined || body.purchasePrice === null
        ? ""
        : String(body.purchasePrice).trim();

    if (!body.confirmationId) {
      return c.json(
        {
          ok: false,
          error: detailsNeeded
            ? "confirmationId is required"
            : "confirmationId, purchasePrice, and purchasedAt are required",
        },
        400,
      );
    }
    if (!detailsNeeded && (purchasePrice === "" || !body.purchasedAt)) {
      return c.json(
        {
          ok: false,
          error: "confirmationId, purchasePrice, and purchasedAt are required",
        },
        400,
      );
    }

    const moneyError = firstInvalidDollar({
      purchasePrice: detailsNeeded ? undefined : purchasePrice,
      shipping: detailsNeeded ? undefined : body.shipping,
      tax: detailsNeeded ? undefined : body.tax,
      fees: detailsNeeded ? undefined : body.fees,
      supplies: detailsNeeded ? undefined : body.supplies,
      referencePriceAmount: body.referencePriceAmount,
    });
    if (moneyError) return c.json({ ok: false, error: moneyError }, 400);
    if (!detailsNeeded && !isIsoDateTime(body.purchasedAt ?? "")) {
      return c.json({ ok: false, error: "purchasedAt must be an ISO date-time" }, 400);
    }

    const confirmation = getConfirmation(userId, body.confirmationId);
    if (!confirmation) {
      return c.json({ ok: false, error: "Confirm the card before Purchased" }, 409);
    }

    const idempotencyKey = c.req.header("idempotency-key")?.trim() || null;
    const replay =
      body.anotherCopy === true
        ? idempotencyKey
          ? getInventoryItem(userId, inventoryIdForIdempotency(userId, "purchased", idempotencyKey))
          : undefined
        : listInventory(userId).find(
            (item) =>
              item.confirmationId === confirmation.confirmationId && item.intent === "purchased",
          );
    if (replay) return c.json({ ok: true, created: false, item: replay });

    if (detailsNeeded) {
      const recentSameCard = listInventory(userId).find(
        (item) =>
          item.intent === "purchased" &&
          item.workflowState === DETAILS_NEEDED_WORKFLOW_STATE &&
          isRecentDetailsNeededDuplicate({
            existing: item,
            cardflowCardId: confirmation.cardflowCardId,
          }),
      );
      if (recentSameCard) return c.json({ ok: true, created: false, item: recentSameCard });

      const createdAt = new Date().toISOString();
      const item = saveInventoryItem({
        inventoryItemId: idempotencyKey
          ? inventoryIdForIdempotency(userId, "purchased", idempotencyKey)
          : crypto.randomUUID(),
        userId,
        cardflowCardId: confirmation.cardflowCardId,
        confirmationId: confirmation.confirmationId,
        scanId: confirmation.scanId,
        intent: "purchased",
        grain: "physical_copy",
        selectedVariant: body.selectedVariant ?? confirmation.selectedVariant,
        condition: body.condition ?? null,
        quantity: 1,
        tags: livestreamContextTags({
          platform: body.platform,
          streamUrl: body.streamUrl,
        }),
        workflowState: DETAILS_NEEDED_WORKFLOW_STATE,
        referencePriceAmount: null,
        targetMaxBuyAmount: null,
        createdAt,
        purchase: {
          purchaseId: crypto.randomUUID(),
          purchasedAt: createdAt,
          currency: LOCKED_DISPLAY_CURRENCY,
          costBasis: detailsNeededCostBasis(),
          maxBuy: computeMaxBuy({
            referencePriceAmount: null,
            preferences: getPreferences(userId),
          }),
        },
      });
      return c.json({ ok: true, item }, 201);
    }

    const remoteWrite = await writePokecollectorCopy(userId, "purchased", {
      tcgdexId: confirmation.tcgdexId,
      selectedVariant: body.selectedVariant ?? confirmation.selectedVariant,
      condition: body.condition,
      purchasePrice,
    });
    if (!remoteWrite.ok) return c.json(remoteWrite, 503);

    const purchasedAt = body.purchasedAt ?? "";
    const costBasis = computeAllInCost({
      purchasePrice,
      shipping: body.shipping,
      tax: body.tax,
      fees: body.fees,
      supplies: body.supplies,
    });
    const maxBuy = computeMaxBuy({
      referencePriceAmount: body.referencePriceAmount ?? null,
      condition: body.condition,
      preferences: getPreferences(userId),
    });
    const item = saveInventoryItem({
      inventoryItemId: idempotencyKey
        ? inventoryIdForIdempotency(userId, "purchased", idempotencyKey)
        : crypto.randomUUID(),
      userId,
      cardflowCardId: confirmation.cardflowCardId,
      confirmationId: confirmation.confirmationId,
      scanId: confirmation.scanId,
      intent: "purchased",
      grain: "physical_copy",
      selectedVariant: body.selectedVariant ?? confirmation.selectedVariant,
      condition: body.condition ?? null,
      quantity: 1,
      tags: ["raw"],
      workflowState: "acquired",
      referencePriceAmount: maxBuy.referencePriceAmount,
      targetMaxBuyAmount: null,
      createdAt: new Date().toISOString(),
      purchase: {
        purchaseId: crypto.randomUUID(),
        purchasedAt,
        currency: LOCKED_DISPLAY_CURRENCY,
        costBasis,
        maxBuy,
      },
    });
    return c.json({ ok: true, item }, 201);
  });

  app.post("/v1/inventory/watchlist", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json<{
      confirmationId?: string;
      selectedVariant?: string | null;
      referencePriceAmount?: string | number | null;
      targetMaxBuyAmount?: string | null;
      condition?: string | null;
      anotherCopy?: boolean;
    }>();
    if (!body.confirmationId) {
      return c.json({ ok: false, error: "confirmationId is required" }, 400);
    }
    const moneyError = firstInvalidDollar({
      referencePriceAmount: body.referencePriceAmount,
      targetMaxBuyAmount: body.targetMaxBuyAmount,
    });
    if (moneyError) return c.json({ ok: false, error: moneyError }, 400);
    const confirmation = getConfirmation(userId, body.confirmationId);
    if (!confirmation) {
      return c.json({ ok: false, error: "Confirm the card before Watchlist" }, 409);
    }
    const idempotencyKey = c.req.header("idempotency-key")?.trim() || null;
    const replay =
      body.anotherCopy === true
        ? idempotencyKey
          ? getInventoryItem(userId, inventoryIdForIdempotency(userId, "watchlist", idempotencyKey))
          : undefined
        : listInventory(userId).find(
            (item) =>
              item.confirmationId === confirmation.confirmationId && item.intent === "watchlist",
          );
    if (replay) {
      return c.json({
        ok: true,
        created: false,
        item: replay,
        maxBuy: computeMaxBuy({
          referencePriceAmount: replay.referencePriceAmount,
          condition: replay.condition,
          preferences: getPreferences(userId),
        }),
      });
    }
    const condition =
      typeof body.condition === "string" && body.condition.trim()
        ? body.condition.trim()
        : null;
    const remoteWrite = await writePokecollectorCopy(userId, "watchlist", {
      tcgdexId: confirmation.tcgdexId,
      selectedVariant: body.selectedVariant ?? confirmation.selectedVariant,
    });
    if (!remoteWrite.ok) return c.json(remoteWrite, 503);
    const maxBuy = computeMaxBuy({
      referencePriceAmount: body.referencePriceAmount ?? null,
      condition,
      preferences: getPreferences(userId),
    });
    const item = saveInventoryItem({
      inventoryItemId: idempotencyKey
        ? inventoryIdForIdempotency(userId, "watchlist", idempotencyKey)
        : crypto.randomUUID(),
      userId,
      cardflowCardId: confirmation.cardflowCardId,
      confirmationId: confirmation.confirmationId,
      scanId: confirmation.scanId,
      intent: "watchlist",
      grain: "interest_not_physical_copy",
      selectedVariant: body.selectedVariant ?? confirmation.selectedVariant,
      condition,
      quantity: null,
      tags: ["raw"],
      workflowState: "watching",
      referencePriceAmount: maxBuy.referencePriceAmount,
      targetMaxBuyAmount: maxBuy.maxBuyAmount,
      createdAt: new Date().toISOString(),
      purchase: null,
    });
    return c.json({ ok: true, item, maxBuy }, 201);
  });

  app.post("/v1/inventory/:inventoryItemId/purchased", async (c) => {
    const userId = c.get("userId");
    const watchlistItemId = c.req.param("inventoryItemId");
    const watchlist = getInventoryItem(userId, watchlistItemId);
    if (!watchlist) return c.json({ ok: false, error: "Inventory item not found" }, 404);
    if (watchlist.intent !== "watchlist") {
      return c.json({ ok: false, error: "Only Watchlist items can convert to Purchased" }, 409);
    }

    const existing = listInventory(userId).find(
      (row) =>
        row.intent === "purchased" && watchlistSourceIdFromTags(row.tags) === watchlistItemId,
    );
    if (existing) {
      if (isOpenWatchlist(watchlist)) {
        updateInventoryItem(userId, watchlistItemId, {
          workflowState: WATCHLIST_CLOSED_WORKFLOW_STATE,
          closedAt: existing.createdAt,
        });
      }
      return c.json({ ok: true, created: false, item: inventoryView(userId, existing) });
    }
    if (!isOpenWatchlist(watchlist)) {
      return c.json({ ok: false, error: "This Watchlist item is already closed" }, 409);
    }

    const confirmation = getConfirmation(userId, watchlist.confirmationId);
    if (!confirmation) {
      return c.json({ ok: false, error: "Confirm the card before Purchased" }, 409);
    }

    const createdAt = new Date().toISOString();
    const maxBuy = computeMaxBuy({
      referencePriceAmount: watchlist.referencePriceAmount,
      condition: watchlist.condition,
      preferences: getPreferences(userId),
    });
    const item = saveInventoryItem({
      inventoryItemId: crypto.randomUUID(),
      userId,
      cardflowCardId: confirmation.cardflowCardId,
      confirmationId: confirmation.confirmationId,
      scanId: confirmation.scanId,
      intent: "purchased",
      grain: "physical_copy",
      selectedVariant: watchlist.selectedVariant ?? confirmation.selectedVariant,
      condition: watchlist.condition,
      quantity: 1,
      tags: watchlistConversionTags(watchlistItemId),
      workflowState: DETAILS_NEEDED_WORKFLOW_STATE,
      referencePriceAmount: maxBuy.referencePriceAmount,
      targetMaxBuyAmount: maxBuy.maxBuyAmount,
      createdAt,
      purchase: {
        purchaseId: crypto.randomUUID(),
        purchasedAt: createdAt,
        currency: LOCKED_DISPLAY_CURRENCY,
        costBasis: detailsNeededCostBasis(),
        maxBuy,
      },
    });
    updateInventoryItem(userId, watchlistItemId, {
      workflowState: WATCHLIST_CLOSED_WORKFLOW_STATE,
      closedAt: createdAt,
    });
    return c.json({ ok: true, created: true, item: inventoryView(userId, item) }, 201);
  });

  app.post("/v1/inventory/:inventoryItemId/purchase", async (c) => {
    const userId = c.get("userId");
    const item = getInventoryItem(userId, c.req.param("inventoryItemId"));
    if (!item) return c.json({ ok: false, error: "Inventory item not found" }, 404);
    if (item.intent !== "purchased") {
      return c.json({ ok: false, error: "Only Purchased copies can store cost details" }, 409);
    }
    if (item.purchase && !isDetailsNeededPurchase(item)) {
      return c.json({ ok: true, created: false, item: inventoryView(userId, item) });
    }
    if (!isDetailsNeededPurchase(item)) {
      return c.json({ ok: false, error: "This copy is not waiting for purchase details" }, 409);
    }

    const body = await c.req.json<{
      purchasePrice?: string | number;
      purchasedAt?: string;
      shipping?: string | number | null;
      tax?: string | number | null;
      fees?: string | number | null;
      supplies?: string | number | null;
      condition?: string | null;
      selectedVariant?: string | null;
      referencePriceAmount?: string | number | null;
    }>();
    const purchasePrice =
      body.purchasePrice === undefined || body.purchasePrice === null
        ? ""
        : String(body.purchasePrice).trim();
    if (purchasePrice === "" || !body.purchasedAt) {
      return c.json(
        { ok: false, error: "purchasePrice and purchasedAt are required" },
        400,
      );
    }
    const moneyError = firstInvalidDollar({
      purchasePrice,
      shipping: body.shipping,
      tax: body.tax,
      fees: body.fees,
      supplies: body.supplies,
      referencePriceAmount: body.referencePriceAmount,
    });
    if (moneyError) return c.json({ ok: false, error: moneyError }, 400);
    if (!isIsoDateTime(body.purchasedAt)) {
      return c.json({ ok: false, error: "purchasedAt must be an ISO date-time" }, 400);
    }

    const confirmation = getConfirmation(userId, item.confirmationId);
    if (confirmation?.tcgdexId) {
      const remoteWrite = await writePokecollectorCopy(userId, "purchased", {
        tcgdexId: confirmation.tcgdexId,
        selectedVariant: body.selectedVariant ?? item.selectedVariant,
        condition: body.condition ?? item.condition,
        purchasePrice,
      });
      if (!remoteWrite.ok) return c.json(remoteWrite, 503);
    }

    const costBasis = computeAllInCost({
      purchasePrice,
      shipping: body.shipping ?? "0",
      tax: body.tax ?? "0",
      fees: body.fees ?? "0",
      supplies: body.supplies ?? "0",
    });
    const maxBuy = computeMaxBuy({
      referencePriceAmount: body.referencePriceAmount ?? item.referencePriceAmount,
      condition: body.condition ?? item.condition,
      preferences: getPreferences(userId),
    });
    const updated = updateInventoryItem(userId, item.inventoryItemId, {
      workflowState: "acquired",
      condition: body.condition ?? item.condition,
      selectedVariant: body.selectedVariant ?? item.selectedVariant,
      referencePriceAmount: maxBuy.referencePriceAmount,
      purchase: {
        purchaseId: item.purchase?.purchaseId ?? crypto.randomUUID(),
        purchasedAt: body.purchasedAt,
        currency: LOCKED_DISPLAY_CURRENCY,
        costBasis,
        maxBuy,
      },
    });
    return c.json({ ok: true, item: inventoryView(userId, updated ?? item) });
  });

  app.post("/v1/inventory/:inventoryItemId/drafts", (c) => {
    const userId = c.get("userId");
    const item = getInventoryItem(userId, c.req.param("inventoryItemId"));
    if (!item) return c.json({ ok: false, error: "Inventory item not found" }, 404);
    if (isDetailsNeededPurchase(item) || item.intent !== "purchased" || !item.purchase) {
      return c.json(
        {
          ok: false,
          error: isDetailsNeededPurchase(item)
            ? "Add purchase details before drafting. Cost basis is required."
            : "Listing drafts are Purchased only. Save as Purchased first.",
        },
        409,
      );
    }
    const existing = getDraftForInventoryItem(userId, item.inventoryItemId);
    if (existing) {
      return c.json({ ok: true, created: false, ...draftView(existing, item) });
    }
    const card = getCanonical(item.cardflowCardId);
    if (!card) return c.json({ ok: false, error: "Canonical card not found" }, 409);
    const draft = saveDraft(createPrefillDraft({ item, card }));
    const updated = updateInventoryItem(userId, item.inventoryItemId, { workflowState: "drafted" });
    return c.json(
      {
        ok: true,
        created: true,
        ...draftView(draft, updated ?? item),
      },
      201,
    );
  });

  app.get("/v1/drafts/:draftId", (c) => {
    const userId = c.get("userId");
    const draft = getDraft(userId, c.req.param("draftId"));
    if (!draft) return c.json({ ok: false, error: "Draft not found" }, 404);
    const item = getInventoryItem(userId, draft.inventoryItemId);
    if (!item) return c.json({ ok: false, error: "Inventory item not found" }, 404);
    const card = getCanonical(item.cardflowCardId);
    return c.json({
      ok: true,
      ...draftView(draft, item),
      keywordChips: card
        ? keywordChips({
            name: card.name,
            setName: card.set.name,
            localId: card.localId,
            selectedVariant: item.selectedVariant,
          })
        : [],
    });
  });

  app.patch("/v1/drafts/:draftId", async (c) => {
    const userId = c.get("userId");
    const draft = getDraft(userId, c.req.param("draftId"));
    if (!draft) return c.json({ ok: false, error: "Draft not found" }, 404);
    const item = getInventoryItem(userId, draft.inventoryItemId);
    const card = getCanonical(draft.cardflowCardId);
    if (!item || !card) return c.json({ ok: false, error: "Draft inventory missing" }, 409);
    const body = await c.req.json<{
      title?: string;
      description?: string;
      condition?: string | null;
      askingPrice?: string | null;
      intendedChannelNote?: string;
      notes?: string;
      titleTemplateId?: TitleTemplateId;
    }>();
    if (
      body.askingPrice !== undefined &&
      body.askingPrice !== null &&
      body.askingPrice.trim() !== "" &&
      parseDollarsToCents(body.askingPrice) === null
    ) {
      return c.json({ ok: false, error: INVALID_DOLLAR_AMOUNT, field: "asking_price" }, 400);
    }
    const next = saveDraft(applyDraftPatch(draft, body, card, item));
    return c.json({ ok: true, ...draftView(next, item) });
  });

  app.post("/v1/drafts/:draftId/ready", (c) => {
    const userId = c.get("userId");
    const draft = getDraft(userId, c.req.param("draftId"));
    if (!draft) return c.json({ ok: false, error: "Draft not found" }, 404);
    const item = getInventoryItem(userId, draft.inventoryItemId);
    if (!item) return c.json({ ok: false, error: "Inventory item not found" }, 404);
    if (!canMarkReadyForReview(draft)) {
      return c.json(
        {
          ok: false,
          error: "ready_for_review requires title, condition, and asking_price",
          missing: readyForReviewMissing(draft),
        },
        400,
      );
    }
    const next = saveDraft({
      ...draft,
      status: "ready_for_review",
      publication: { published: false, marketplace: null },
      updatedAt: new Date().toISOString(),
    });
    return c.json({ ok: true, ...draftView(next, item) });
  });

  app.get("/v1/drafts/:draftId/clipboard", (c) => {
    const draft = getDraft(c.get("userId"), c.req.param("draftId"));
    if (!draft) return c.json({ ok: false, error: "Draft not found" }, 404);
    return c.json({
      ok: true,
      clipboard: clipboardForDraft(draft),
    });
  });

  return app;
}

/** UUID-shaped so scan paths and storage refs stay the same shape as random scan IDs. */
function scanIdForIdempotency(userId: string, key: string): string {
  const h = createHash("sha256").update(`${userId}\0scan\0${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function inventoryIdForIdempotency(
  userId: string,
  intent: "purchased" | "watchlist",
  key: string,
): string {
  const digest = createHash("sha256").update(`${userId}\0${intent}\0${key}`).digest("hex");
  return `idem-${digest.slice(0, 32)}`;
}

function firstInvalidDollar(fields: Record<string, string | number | null | undefined>): string | null {
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    if (parseDollarsToCents(value) === null) {
      return name === "purchasePrice" || name === "referencePriceAmount"
        ? INVALID_DOLLAR_AMOUNT
        : `${name}: ${INVALID_DOLLAR_AMOUNT}`;
    }
  }
  return null;
}

function isIsoDateTime(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
