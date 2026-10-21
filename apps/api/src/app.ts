import { FEATURE_DISABLED_HEADER, featureDisabledBody, livestreamEnabledFromEnv } from "@cardflow/shared";
import { buildDexSet, dexOwnedCountsBySet, type DexCatalogCard, type DexSetSummary, type TcgdexSetBrief } from "@cardflow/shared";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { emailSenderFromEnv, type EmailSender } from "./email-sender";
import { cardSightMonthKey, consentState, hasActiveConsent } from "./consent-store";
import {
  AGE_CONFIRMATION_REQUIRED_CODE,
  AGE_GATE_COPY,
  AGE_GATE_VERSION,
  livestreamAccessAllowed,
  livestreamAccessFor,
  type LivestreamAccess,
} from "@cardflow/shared";
import { ageConfirmationState, hasAgeConfirmation } from "./age-store";
import { termsGateEnabledFromEnv, ageGateEnabledFromEnv, cardMagicIdReserveFromEnv, cardSightMonthlyBudgetFromEnv, CARDSIGHT_GUEST_MONTHLY_CAP, CARDSIGHT_USER_MONTHLY_CAP_DEFAULT } from "./grade-quota-env";
import {
  monthStartIso,
  recognitionWithMultiCardMappings,
  scanQuotaForUser,
} from "./multi-card-scan";
import { SCAN_QUOTA_COPY, TERMS_COPY, TERMS_REQUIRED_CODE, TERMS_VERSION } from "@cardflow/shared";
import { NO_PASSWORD_HASH, type SocialProvider } from "./account-store";
import { appleKeyConfigFromEnv, createAppleTokenClient, openToken, sealToken, type AppleTokenClient } from "./apple-revoke";
import {
  createJwksSocialVerifier,
  socialAuthConfigFromEnv,
  socialProviderEnabled,
  type SocialAuthConfig,
  type SocialTokenVerifier,
} from "./social-auth";
import type { CardMagicClient } from "./cardmagic-adapter";
import { cardMagicCornersToExtraShots, tryCardMagicForGrade, type GradeCropPath } from "./grade-cardmagic";
import { canCardMagicUseBudget, consumeCardSightBudget } from "./cardsight-budget";
import { ALLOWANCE_TOMBSTONE_TTL_MS, allowanceTombstoneKey, normalizeEmail, type DeletionAuditKind } from "./account-store";
import { routePath } from "hono/route";
import { CARDSIGHT_CONSENT_VERSION, INVITED_USERS, EMAIL_CODE_LIFETIME_SENDS, EMAIL_SENDS_PER_ADDRESS_PER_DAY, UNVERIFIED_ACCOUNT_TTL_DAYS, EMAIL_CODE_LENGTH, EMAIL_RESEND_COOLDOWN_MS, EMAIL_UNVERIFIED_CODE, EMAIL_VERIFICATION_COPY, EMAIL_VERIFICATION_TTL_MS, isEmailCode, passwordResetEmailText, verificationEmailText, quotaAnchor, quotaPeriodFor, ACCOUNT_AUTH_COPY, ACCOUNT_DELETION_COPY, PASSWORD_RESET_TTL_MS, GUEST_MINT_WINDOW_MS, GUEST_SESSION_TTL_MS, isValidEmail, passwordProblem, GUEST_USER_PREFIX, SIGNUP_REQUIRED_CODE, guestIdentity, guestRouteBlockReason, isGuestUserId, isHot, parsePerfBatch, signupMessage, type SignupReason } from "@cardflow/shared";
import { NORTH_STAR_NAME, SCANS_PER_WAR_NAME, northStarUserWeekTotals, northStarWeekly, type NorthStarWeekTotal } from "@cardflow/shared";
import { ANONYMIZED_USER_PREFIX } from "./purchase-ledger";
import { opsMetrics, type OpsMetrics } from "./ops-metrics";
import {
  createLiveCardSightGate,
  LIVE_CARDSIGHT_GLOBAL_METER,
  LIVE_ONE_CARD_HINT,
  inHouseConfident,
  liveCardSightEnabledFromEnv,
  liveCardSightUserMonthMeter,
  liveInHouseGateFromEnv,
  utcMonthKey,
  type LiveInHouseGate,
  liveCardSightLimitsFromEnv,
  liveCardSightUserMeter,
  liveCardSightVerdict,
  liveMaskRegionsFromEnv,
  maskLiveCrop,
  utcDayKey,
  type LiveCardSightLimits,
  type NormRect,
} from "./livestream-cardsight";
import { parseUserPriceAmount } from "@cardflow/shared";
import { OUT_OF_FULL_GRADES_CODE, GRADE_FULL_COPY, gradeFullAllowance, gradeFullModeEnabled, gradeFullMonthlyLimit, gradeFullUsageKey } from "@cardflow/shared";
import {
  checkExtraBlur,
  deleteUserGradeExtras,
  deleteGradeExtrasSession,
  gradeExtrasSessionPath,
  purgeExpiredGradeExtras,
  saveGradeExtraShot,
} from "./grade-extra-store";

/** Full 14-photo mode flag (docs/GRADE_FULL_MODE.md). Read per request so tests can flip it. */
function gradeFullModeFlag(): string | undefined {
  return process.env.CARD_FLOW_GRADE_FULL_MODE;
}
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
  LIVESTREAM_SOURCE_TAG,
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
  invitedIdentityByUserId,
  searchCatalog,
  slabPricingHealth,
  updateReturnedCopy,
  updateSubmittedCopy,
  WATCHLIST_CANNOT_SUBMIT_MESSAGE,
  type CardCatalogProvider,
  type CardFlowCanonicalCard,
  type CardFlowNormalizedRecognitionResult,
  type LiveVideoIdentityResult,
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
  BATCH_GRADE_HEADER,
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
import { registerGradeJobRoutes, type GradeJobRoutes } from "./routes/grade-jobs";
import { registerStatusRoutes } from "./routes/status";
import { registerSalesRoutes } from "./routes/sales";
import { premiumRequiredBody, recordGradeEstimate, registerGradeHistoryRoutes } from "./routes/grade-history";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";
import { captureApiException } from "./sentry";
import {
  JSON_BODY_MAX_BYTES,
  LIVESTREAM_IDENTIFY_BODY_MAX_BYTES,
  GRADE_ROUTE_BODY_MAX_BYTES,
} from "./request-limits";
import { unmappedSetNameCounts } from "./tcgdex-catalog";
import { createMemoryStore, type InventoryItemRecord, type ScanRecord, type StorePort } from "./store";
import {
  offPokecollectorAccounts,
  isLegacyLink,
  isPendingLink,
  isReadyLink,
  type PokecollectorAccounts,
  type PokecollectorCollectionCopy,
} from "./pokecollector-accounts";
import { createPokecollectorDeletionQueue, pokecollectorDeletionCounts, type PokecollectorDeletionQueue } from "./pokecollector-deletion-queue";
import type { PokecollectorPacer } from "./pokecollector-pacer";
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
import { parseGradeDetectRequest, parseGradeEstimateRequest, parseGradeExtraRequest, type ParsedGradeStill } from "./grade-estimate-request";
import { detectCardForGrade, pregradePhotoPair } from "./grade-photo-flow";
import { stripImageMetadata } from "./grade-image";
import type { CardgradingRunner } from "./cardgrading-run";
import {
  applyDraftPatch,
  clipboardForDraft,
  createPrefillDraft,
  draftView,
} from "./listing";
import { identityForInviteCode } from "./invited-testers";
import { createIdempotencyRegistry, hashRequestBody, IDEMPOTENCY_TTL_MS } from "./idempotency";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";
import {
  hashSessionToken,
  isSessionExpired,
  mintSessionToken,
  sessionExpiryIso,
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

/** Pre-grade estimate routes that need a verified email (POST only). */
export function requiresVerifiedEmail(pathName: string): boolean {
  return (
    pathName === "/v1/grade/detect" ||
    pathName === "/v1/grade/extra" ||
    pathName === "/v1/grade/pregrade" ||
    pathName === "/v1/grading/batch" ||
    /^\/v1\/inventory\/[^/]+\/(grade-jobs|grade-estimate)$/.test(pathName)
  );
}

function isPublicV1Path(method: string, pathName: string): boolean {
  // Sean (Oct 19): everything else needs a signed-in account; only sign-in/sign-up is public.
  if (method === "GET" && pathName === "/v1/auth/providers") return true;
  return (
    method === "POST" &&
    [
      "/v1/sessions",
      "/v1/sessions/guest",
      "/v1/sessions/password",
      "/v1/sessions/social",
      "/v1/accounts",
      "/v1/password-resets",
      "/v1/password-resets/confirm",
    ].includes(pathName)
  );
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
  /**
   * Legacy guest sessions (retired for the app, Sean Oct 18). Off by default. When on
   * (CARD_FLOW_GUEST_BROWSE=true or tests), minting still works and browse-only gating applies,
   * but the mobile app never calls POST /v1/sessions/guest. Prefer leaving this off.
   * CARD_FLOW_GUEST_SCANS is ignored (no guest scans).
   */
  guestMode?: boolean;
  /** D9: how often ended-guest data is purged (default hourly; always within 24 h). */
  guestCleanupIntervalMs?: number;
  /** D9 tests: receives the cleanup function so a test can run it on demand. */
  onGuestCleanup?: (run: () => { guestsPurged: number; scansDeleted: number }) => void;
  /** Open sign-up limits (per IP / per email). */
  authLimits?: { signupPerIp?: number; signInPerIp?: number; perEmail?: number; invitePerIp?: number };
  /** Forgot password delivery override (tests). Default: the email sender. */
  deliverPasswordReset?: (email: string, token: string) => void;
  /** Verification and reset emails. Default from CARD_FLOW_EMAIL_SENDER (dev logger when unset). */
  emailSender?: EmailSender;
  /** Hourly purge of accounts unverified after 7 days. 0 turns the timer off (tests). */
  unverifiedPurgeIntervalMs?: number;
  /**
   * Sean (Oct 17): sign-up must state 18+ (`ageConfirmed18Plus`). Always on outside tests (see
   * ageGateEnabledFromEnv).
   */
  ageGate?: boolean;
  /** Sean (Oct 19): sign-up must accept the Terms of Service. Always on outside tests. */
  termsGate?: boolean;
  /** Sign in with Apple / Google (tests inject a verifier; default reads env + provider JWKS). */
  socialAuth?: { config: SocialAuthConfig; verifier?: SocialTokenVerifier; apple?: AppleTokenClient | null };
  /** Tests: receives the purge so it can run on demand. */
  onUnverifiedPurge?: (run: () => { accountsPurged: number }) => void;
  /** Backend review M1 (P4): orphan sweep interval (0 = off; default 6 h) and a test handle. */
  orphanSweepIntervalMs?: number;
  onOrphanSweep?: (run: () => { accountsSwept: number; imagesSwept: number }) => void;
  /**
   * Backend re-review H1/M1 (P4): how often the PokéCollector deletion queue runs (default 1 min;
   * 0 turns the timer off, tests run it through `onPokecollectorDeletionQueue`).
   */
  pokecollectorDeletionIntervalMs?: number;
  onPokecollectorDeletionQueue?: (queue: PokecollectorDeletionQueue) => void;
  /** Pacing for background PokéCollector calls (tests pass an unpaced one). */
  pokecollectorPacer?: PokecollectorPacer;
  /** D9: guest sessions minted per client IP per hour (default 10). */
  guestMintsPerHour?: number;
  /** Catalog provider. Tests default to mock; local/staging may inject live TCGdex or PokéCollector. */
  catalog?: CardCatalogProvider;
  /** Pricing provider. Tests default to off; local stack may inject PokéCollector. */
  pricing?: CardPricingProvider;
  /** Recognition provider. Tests default to mock; live Capture uses `obb_phash`. */
  recognition?: CardRecognitionProvider;
  /**
   * Sean: CardSight adapter (null/undefined = not configured). Called only for users whose
   * current-version consent is on; everyone else gets the local matcher.
   */
  cardSight?: CardRecognitionProvider | null;
  /**
   * Backend review M5: CardSight calls per account per calendar month (default 50; see
   * cardSightUserCapsFromEnv). Past the cap, scans use the local matcher. Guests: always 0.
   */
  cardSightUserCaps?: { signedIn: number };
  /**
   * Sean (Oct 18): CardMagic for saved grading photos. Null/undefined = off.
   * Same consent/age/guest rules as CardSight identify; falls back to local detect.
   */
  cardMagic?: CardMagicClient | null;
  /** P1-07: async grade jobs. Defaults to CARD_FLOW_GRADE_JOBS=on (off). */
  gradeJobs?: boolean;
  gradeJobLimits?: { ttlMs?: number; maxActiveJobs?: number; maxActiveJobsPerUser?: number; sweepMs?: number; maxStoredJobs?: number };
  /** P1-21: /v1/status cache window (ms). Default 30 s. */
  statusCacheMs?: number;
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
  /**
   * Live Scan remote kill switch. Defaults to `CARD_FLOW_LIVESTREAM_ENABLED` (on unless 0/false/off/no),
   * read per request. Off: /v1/livestream/* answers 503 feature_disabled; /v1/status reports it.
   */
  livestreamEnabled?: () => boolean;
  /**
   * Sean (Oct 21): Live Scan identifies with CardSight (automatic, Medium/High only). Needs `cardSight`.
   * Defaults to `CARD_FLOW_LIVESTREAM_CARDSIGHT` (on unless 0/false/off/no). In-house matcher still
   * runs, hidden, for comparison logging only.
   */
  livestreamCardSight?: boolean;
  /** Live Scan CardSight caps. Defaults to env (see livestream-cardsight.ts). */
  liveCardSightLimits?: LiveCardSightLimits;
  /** Hybrid: in-house confidence gate (CARD_FLOW_LIVE_INHOUSE_MIN_SIMILARITY / _MIN_MARGIN). */
  liveInHouseGate?: LiveInHouseGate;
  /** Whatnot overlay regions blacked out before a crop goes to CardSight. */
  liveMaskRegions?: readonly NormRect[];
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
   * Calls reserved for card ID so CardMagic cannot burn the free plan.
   * Defaults to `CARD_FLOW_CARDMAGIC_ID_RESERVE` (600 when cap is 750, else ~80% of cap).
   */
  cardMagicIdReserve?: number;
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

/** SqliteStorePort exposes ping(); the memory store has no DB to check. */
function storePing(store: StorePort): { ok: boolean; journalMode: string } | null {
  const ping = (store as { ping?: () => { ok: boolean; journalMode: string } }).ping;
  return typeof ping === "function" ? ping.call(store) : null;
}

/** Exported by apps/api/docker/entrypoint.sh; "off" outside the container. */
export function litestreamModeFromEnv(
  env: NodeJS.Dict<string | undefined> = process.env,
): "replicate" | "restore-only" | "off" {
  const mode = env.CARD_FLOW_LITESTREAM_MODE_EFFECTIVE?.trim();
  return mode === "replicate" || mode === "restore-only" ? mode : "off";
}

/** Routes write through StorePort. Tests default to memory; local `pnpm dev:api` injects SQLite. */
export function createApp(
  store: StorePort = createMemoryStore(),
  options: CreateAppOptions = {},
) {
  /** Sean (Oct 19): a scan's photo is deleted once identification and every confirm are done. */
  function deleteScanPhotoWhenSettled(userId: string, scan: ScanRecord): void {
    const pending = scan.cardResults?.some((row) => row.state !== "confirmed" && row.state !== "skipped");
    if (!pending) store.deleteScanImage(userId, scan.scanId);
  }
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
    skipScanCard,
    createSession,
    findCachedCanonicals,
    getCanonical,
    getConfirmation,
    getDraft,
    getDraftForInventoryItem,
    getInventoryItem,
    getPreferences,
    getScan,
    listScans,
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
    setGradeQuotaUsage,
    consumeGradeQuota,
  } = store;
  const now = options.now ?? (() => new Date());
  const quotaEnabled =
    options.gradeQuota === undefined ? gradeQuotaEnabledFromEnv() : Boolean(options.gradeQuota);
  const gradeIap = options.gradeIap ?? gradeIapFromEnv();
  const premiumUserIds = new Set(options.premiumUserIds ?? premiumUserIdsFromEnv());
  const appApiKey = options.appApiKey === undefined ? appApiKeyFromEnv() : options.appApiKey;
  const devAutoSession = options.devAutoSession ?? resolveDevAutoSession();
  // Guest mode is off with dev auto-session (that already signs everyone in).
  // Sean (Oct 19): no guest mode in the app or API. Only legacy tests can still turn it on.
  const guestMode = !devAutoSession && options.guestMode === true;
  if (options.guestMode === undefined && process.env.CARD_FLOW_GUEST_SCANS?.trim()) {
    console.warn("[guest] CARD_FLOW_GUEST_SCANS is ignored (no guest scans). Guest mode is removed (Sean, Oct 19).");
  }
  const guestMintsPerHour = options.guestMintsPerHour ?? 10;
  /** Scan Idempotency-Key -> first scan ID (body hash, in-flight, 24 h). */
  const scanIdempotency = createIdempotencyRegistry<string>(() => now().getTime());
  /** Guest mints per client IP in the last hour. Pruned on every mint. */
  const guestMints = new Map<string, { windowStart: number; count: number }>();
  /**
   * Backend review M1 (P4): user IDs deleted in the last 24 h. Work that was in flight when the
   * account was deleted (a scan waiting on recognition, a grade job) checks this before it saves.
   */
  const deletedUserIds = new Map<string, number>();
  /**
   * Backend review H1 (P4): short-lived, PII-free deletion receipts keyed by a hash of the bearer
   * token, so a retried delete (the first response was lost) gets 410 instead of a plain 401.
   */
  const deletionReceipts = new Map<string, number>();
  const DELETION_MEMORY_TTL_MS = 24 * 60 * 60 * 1000;
  const deletionReceiptKey = (token: string) => createHash("sha256").update(`cardflow-deletion-receipt\0${token}`).digest("hex");
  const pruneDeletionMemory = () => {
    const cutoff = now().getTime() - DELETION_MEMORY_TTL_MS;
    for (const [id, at] of deletedUserIds) if (at < cutoff) deletedUserIds.delete(id);
    for (const [key, at] of deletionReceipts) if (at < cutoff) deletionReceipts.delete(key);
  };
  const wasDeleted = (userId: string) => deletedUserIds.has(userId);
  const accountDeletedBody = { ok: false as const, code: "account_deleted" as const, error: "This account was deleted." };
  let gradeJobRoutes: GradeJobRoutes | null = null;
  /**
   * D9 retention: guest sessions live in crm_sessions (is_guest, 24-hour expiry), so a restart
   * keeps valid guests. A guest who signs up has their scans moved to the new account. A guest
   * who never signs up has every row deleted within 24 h after the session expires (hourly job).
   */
  /**
   * Backend review H2 (P4): the weekly counts this user adds to /ops/north-star (same rule: invited
   * testers, signed-up accounts, and anyone with purchase ledger rows), taken just before their
   * rows are deleted and stored as anonymous totals in the same transaction.
   */
  const northStarTotalsFor = (userId: string): NorthStarWeekTotal[] => {
    const purchases = store.purchaseLedger.activePurchaseTimes(userId);
    const counted =
      store.listInvitedUsers().some((user) => user.userId === userId) ||
      Boolean(store.accounts.getAccount(userId)) ||
      store.purchaseLedger.list(userId).length > 0;
    if (!counted) return [];
    return northStarUserWeekTotals({ scans: store.listScans(userId).map((scan) => scan.capturedAt), purchases });
  };
  // Before H2, deleted accounts' ledger rows stayed under `deleted_<uuid>`: fold them into the
  // totals once (they have no scans left) and delete them.
  // Re-review L4: the counts are read inside the delete's transaction.
  for (const legacyId of store.purchaseLedger.listUserIds()) {
    if (!legacyId.startsWith(ANONYMIZED_USER_PREFIX)) continue;
    store.accounts.deleteAllUserRows(legacyId, { northStarTotals: () => northStarTotalsFor(legacyId) });
  }
  const runGuestCleanup = () => {
    const at = now().toISOString();
    let guestsPurged = 0;
    let scansDeleted = 0;
    const ended = new Set(store.accounts.purgeExpiredGuestSessions(at));
    for (const userId of store.listScanUserIds(GUEST_USER_PREFIX)) ended.add(userId);
    for (const userId of ended) {
      if (store.accounts.hasLiveSession(userId, at)) continue;
      const scans = store.listScans(userId).length;
      store.deleteUserPhotos(userId);
      deleteUserGradeExtras(userId);
      // Re-review H1: a guest's PokéCollector user is shared (legacy `cardflow-guest`): held, never deleted.
      const link = getPokecollectorUserMapping(userId);
      store.accounts.deleteAllUserRows(userId, {
        northStarTotals: () => northStarTotalsFor(userId),
        pokecollectorRemote: link && !isPendingLink(link) ? { remoteUserId: link.pokecollectorUserId, hold: true, at } : undefined,
      });
      if (scans > 0) {
        guestsPurged += 1;
        scansDeleted += scans;
      }
    }
    return { guestsPurged, scansDeleted };
  };
  /** Sign-up/sign-in from a guest bearer: move the guest's scans to the account (one transaction). */
  const adoptGuestData = (authorization: string | undefined, toUserId: string) => {
    const token = parseBearerToken(authorization);
    if (!token) return null;
    const session = getSessionByToken(token, now());
    if (!session?.isGuest || session.userId === toUserId) return null;
    return store.accounts.moveGuestData(session.userId, toUserId);
  };
  if (guestMode) {
    options.onGuestCleanup?.(runGuestCleanup);
    const timer = setInterval(() => {
      try {
        runGuestCleanup();
      } catch {
        // retried next tick
      }
    }, Math.min(options.guestCleanupIntervalMs ?? 60 * 60 * 1000, 24 * 60 * 60 * 1000));
    timer.unref?.();
  }
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
  const cardSightUserCaps = options.cardSightUserCaps ?? { signedIn: CARDSIGHT_USER_MONTHLY_CAP_DEFAULT };
  const cardMagic = options.cardMagic ?? null;
  const cardSightMonthlyBudget =
    options.cardSightMonthlyBudget !== undefined
      ? options.cardSightMonthlyBudget
      : cardSightMonthlyBudgetFromEnv();
  const cardMagicIdReserve =
    options.cardMagicIdReserve !== undefined
      ? options.cardMagicIdReserve
      : cardMagicIdReserveFromEnv(process.env, cardSightMonthlyBudget);
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
      return c.json({ ok: false, error: "PokeSniper is busy. Try again in a moment." }, 503);
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
  const liveCardSightOn = options.livestreamCardSight ?? liveCardSightEnabledFromEnv(process.env);
  const liveCardSightLimits = options.liveCardSightLimits ?? liveCardSightLimitsFromEnv(process.env);
  const liveMaskRegions = options.liveMaskRegions ?? liveMaskRegionsFromEnv(process.env);
  const liveInHouseGate = options.liveInHouseGate ?? liveInHouseGateFromEnv(process.env);
  const liveCardSightGate = createLiveCardSightGate(liveCardSightLimits, () => now().getTime());
  const liveVideoObb = options.liveVideoObb ?? (() => null);
  const gradeUploads = options.gradeUploads ?? defaultGradeUploadCache;

  /**
   * Opaque per-user PokéCollector accounts: every PokeSniper user gets their own remote user
   * (`cardflow-u-<HMAC>`), created fresh and never looked up by name or derived from the email or
   * label. Guests are never bound. Legacy (email-derived) links are never used; the relink script
   * moves them to an opaque user rebuilt from PokeSniper's inventory.
   */
  async function bindPokecollectorUser(identity: InvitedIdentity) {
    const userId = identity.userId;
    if (isGuestUserId(userId)) return undefined;
    const existing = getPokecollectorUserMapping(userId);
    if (isReadyLink(existing)) return existing;
    if (existing && isLegacyLink(existing)) return undefined;
    if (pokecollectorAccounts.name === "off") return undefined;
    try {
      // Pending row first (encrypted password), so a crash after the remote create can finish.
      const pending = existing ?? pokecollectorAccounts.newPendingLink(userId);
      if (!pending) return undefined;
      if (!existing) savePokecollectorUserMapping(pending);
      const linked = await pokecollectorAccounts.completeLink(pending);
      if (!linked) return undefined;
      return savePokecollectorUserMapping(linked);
    } catch {
      return undefined;
    }
  }

  async function mappedPokecollectorUser(userId: string) {
    if (isGuestUserId(userId)) return undefined;
    const identity = resolveIdentity(userId);
    if (!identity) return undefined;
    const existing = getPokecollectorUserMapping(userId);
    return isReadyLink(existing) ? existing : await bindPokecollectorUser(identity);
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
    error: "MyDEX is temporarily unavailable. Confirm still works — try again in a moment.",
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
    // Guests are never linked to PokéCollector: their cards stay in PokeSniper only.
    if (pokecollectorAccounts.name === "off" || isGuestUserId(userId)) return { ok: true as const };
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
  /**
   * Grade jobs replay grade-estimate in-process. The owner is attached to the Request object
   * (unforgeable from the network) instead of re-sending the user's auth headers. Read here,
   * first, because body-limit middleware may swap `c.req.raw`.
   */
  const internalJobRequests = new WeakMap<Request, { userId: string; identity: unknown }>();
  app.use("*", async (c, next) => {
    const internalOwner = internalJobRequests.get(c.req.raw);
    if (internalOwner) {
      internalJobRequests.delete(c.req.raw);
      c.set("internalOwner", internalOwner);
    }
    const requestId = resolveRequestId(c.req.header(REQUEST_ID_HEADER));
    c.set("requestId", requestId);
    c.header(REQUEST_ID_HEADER, requestId);
    const startedAt = performance.now();
    await next();
    if (c.req.path !== "/health" && !c.res.headers.get(FEATURE_DISABLED_HEADER)) {
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
  // D10 / P1-20: North Star, same token rule. Counts only (no user IDs leave the server).
  app.get("/ops/north-star", (c) => {
    const expected = opsToken?.trim();
    const given = c.req.header("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (!expected) return c.json({ ok: false, error: "Not found" }, 404);
    if (!given || !timingSafeEqualString(given, expected)) {
      return c.json({ ok: false, error: "Unauthorized" }, 401);
    }
    // Invited testers + signed-up accounts (#86) + ledger user IDs (#88). Guests are not counted.
    const userIds = [
      ...new Set([
        ...store.listInvitedUsers().map((user) => user.userId),
        ...store.accounts.listAccountUserIds(),
        ...store.purchaseLedger.listUserIds(),
      ]),
    ];
    const users = userIds.map((userId) => ({
      userId,
      scans: listScans(userId).map((scan) => scan.capturedAt),
      // Data Engineer review: from the purchase ledger, excluding voided (undone) purchases.
      purchases: store.purchaseLedger.activePurchaseTimes(userId),
    }));
    // Backend review H2 (P4): deleted accounts are in the anonymous weekly totals instead.
    const weeks = northStarWeekly(users, {
      weeks: Number(c.req.query("weeks") ?? "8") || 8,
      totals: store.accounts.listNorthStarTotals(),
    });
    return c.json({ ok: true, metric: NORTH_STAR_NAME, companionMetric: SCANS_PER_WAR_NAME, weeks });
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
  const signupRequired = (c: Context, reason: SignupReason) =>
    c.json({ ok: false, code: SIGNUP_REQUIRED_CODE, reason, error: signupMessage(reason) }, 403);

  app.post("/v1/sessions/guest", (c) => {
    if (!guestMode) return c.json({ ok: false, error: "Not found" }, 404);
    const ip = clientIp(c, trustProxyHops, socketAddress) ?? "unknown";
    const nowMs = now().getTime();
    for (const [key, entry] of guestMints) if (nowMs - entry.windowStart >= GUEST_MINT_WINDOW_MS) guestMints.delete(key);
    const bucket = guestMints.get(ip);
    if (bucket) {
      if (bucket.count >= guestMintsPerHour) {
        c.header("Retry-After", String(Math.ceil((bucket.windowStart + GUEST_MINT_WINDOW_MS - nowMs) / 1000)));
        return c.json({ ok: false, error: "Too many requests" }, 429);
      }
      bucket.count += 1;
    } else {
      guestMints.set(ip, { windowStart: nowMs, count: 1 });
    }
    const userId = `${GUEST_USER_PREFIX}${crypto.randomUUID()}`;
    const minted = store.accounts.mintSession(userId, {
      guest: true,
      at: now().toISOString(),
      expiresAt: new Date(nowMs + GUEST_SESSION_TTL_MS).toISOString(),
    });
    return c.json({
      ok: true as const,
      token: minted.token,
      identity: guestIdentity(userId),
      guest: true as const,
      browseOnly: true as const,
      expiresAt: minted.expiresAt,
    });
  });

  const livestreamEnabled =
    options.livestreamEnabled ?? (() => livestreamEnabledFromEnv(process.env.CARD_FLOW_LIVESTREAM_ENABLED));
  // Policy Reviewer (Oct 20): remote off switch for Live Scan, ahead of auth and body parsing.
  app.use("/v1/livestream/*", async (c, next) => {
    if (!livestreamEnabled()) {
      // Marked so ops metrics don't count it toward 5xx error-spike alerts.
      c.header(FEATURE_DISABLED_HEADER, "livestream");
      return c.json(featureDisabledBody("livestream"), 503);
    }
    return next();
  });

  app.use("/v1/*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") return next();
    const type = (c.req.header("content-type") ?? "").toLowerCase();
    if (type.includes("multipart/form-data")) return next();
    if (c.req.path === "/v1/livestream/identify") return identifyBodyLimit(c, next);
    return jsonBodyLimit(c, next);
  });

  app.use("/v1/*", async (c, next) => {
    if (!appApiKey || c.get("internalOwner")) return next();
    const presented = c.req.header(APP_API_KEY_HEADER) ?? "";
    if (presented !== appApiKey) {
      return c.json({ ok: false, error: "PokeSniper couldn't authorize that request." }, 401);
    }
    return next();
  });

  /** Invited tester, open sign-up account, or null. */
  function resolveIdentity(userId: string): InvitedIdentity | null {
    const invited = invitedIdentityByUserId(userId);
    if (invited) return invited;
    const account = store.accounts.getAccount(userId);
    return account ? { userId: account.userId, label: account.email } : null;
  }

  function resolveAccountPlan(userId: string, stored: GradePlan): GradePlan {
    return premiumUserIds.has(userId) ? "premium" : stored;
  }

  /**
   * Sean (Oct 18): allowances reset on the 1st of each calendar month (UTC); an account with a
   * billing date (Apple) keeps that date. No rollover. Bought credits are separate and never expire (Sean, Oct 16; Apple 3.1.1).
   */
  function quotaPeriodForUser(userId: string, at: Date) {
    const account = store.ensureGradeAnchor(userId, at.toISOString());
    const anchor = quotaAnchor({ billingAnchorAt: account.billingAnchorAt, createdAt: account.anchorAt ?? at.toISOString() });
    return { account, period: quotaPeriodFor(anchor, at) };
  }

  function quotaSnapshotFor(userId: string): GradeQuotaSnapshot {
    const at = now();
    const { account, period } = quotaPeriodForUser(userId, at);
    const plan = resolveAccountPlan(userId, account.plan);
    const snapshot = gradeQuotaSnapshot({
      plan,
      usedThisMonth: getGradeQuotaUsage(userId, period.key),
      extraCredits: account.extraCredits,
      iapEnabled: gradeIap.enabled,
      now: at,
      period,
    });
    return withFullGrade(snapshot, userId, plan, period.key);
  }

  /** Full 14-photo grade allowance (Sean, Oct 18), only while CARD_FLOW_GRADE_FULL_MODE=on. */
  function withFullGrade(snapshot: GradeQuotaSnapshot, userId: string, plan: GradePlan, periodKey: string): GradeQuotaSnapshot {
    if (!gradeFullModeEnabled(gradeFullModeFlag())) return snapshot;
    return { ...snapshot, fullGrade: gradeFullAllowance(plan, getGradeQuotaUsage(userId, gradeFullUsageKey(periodKey))) };
  }

  /** Spends one full grade from this period's allowance; bought credits are never used for it. */
  function takeFullGradeAllowance(userId: string) {
    const at = now();
    const { account, period } = quotaPeriodForUser(userId, at);
    const plan = resolveAccountPlan(userId, account.plan);
    const consumed = quotaEnabled
      ? consumeGradeQuota(userId, {
          monthKey: gradeFullUsageKey(period.key),
          monthlyLimit: gradeFullMonthlyLimit(plan),
          at: at.toISOString(),
          noCredits: true,
        })
      : { ok: true as const };
    return { ok: consumed.ok, quota: quotaSnapshotFor(userId) };
  }

  function outOfFullGradesResponse(c: Context, quota: GradeQuotaSnapshot) {
    return c.json({ ok: false, code: OUT_OF_FULL_GRADES_CODE, error: GRADE_FULL_COPY.usedUp, quota }, 429);
  }

  function takeGradeAllowance(userId: string) {
    if (!quotaEnabled) {
      return { ok: true as const, quota: quotaSnapshotFor(userId) };
    }
    const at = now();
    const { account, period } = quotaPeriodForUser(userId, at);
    const plan = resolveAccountPlan(userId, account.plan);
    const consumed = consumeGradeQuota(userId, {
      monthKey: period.key,
      monthlyLimit: monthlyLimitForPlan(plan),
      at: at.toISOString(),
    });
    const quota = gradeQuotaSnapshot({
      plan,
      usedThisMonth: consumed.usedThisMonth,
      extraCredits: consumed.extraCredits,
      iapEnabled: gradeIap.enabled,
      now: at,
      period,
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
      // P5: `code` lets the app tell an empty allowance from a rate limit (both are 429).
      { ok: false, code: "out_of_grades", error: GRADE_QUOTA_COPY.outOfGrades, quota },
      429,
    );
  }

  app.use("/v1/*", async (c, next) => {
    if (isPublicV1Path(c.req.method, c.req.path)) return next();
    const internal = c.get("internalOwner");
    if (internal) {
      // Backend review M1: a grade job that outlived its account stops here.
      if (wasDeleted(internal.userId)) return c.json(accountDeletedBody, 410);
      c.set("userId", internal.userId);
      c.set("identity", internal.identity as never);
      return next();
    }
    const token = parseBearerToken(c.req.header("authorization"));
    if (token) {
      const session = getSessionByToken(token, now());
      if (!session) {
        // Backend review H1: a repeat delete with the token that deleted the account → 410.
        if (c.req.method === "POST" && c.req.path === "/v1/account/delete" && deletionReceipts.has(deletionReceiptKey(token))) {
          return c.json(accountDeletedBody, 410);
        }
        return c.json({ ok: false, error: "Unauthorized" }, 401);
      }
      if (session.isGuest) {
        if (!guestMode) return c.json({ ok: false, error: "Unauthorized" }, 401);
        c.set("userId", session.userId);
        c.set("identity", guestIdentity(session.userId));
        // Sean (Oct 17): browse-only. Scans, grades, livestream, saves and CardSight need sign-up.
        const blocked = guestRouteBlockReason(c.req.method, c.req.path);
        if (blocked) return signupRequired(c, blocked);
        return next();
      }
      const identity = resolveIdentity(session.userId);
      if (!identity) return c.json({ ok: false, error: "Unauthorized" }, 401);
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

  /**
   * Backend review M3: verified means an account row with a confirmed email, or an invite tester
   * (fixed roster IDs). No account row (guests, unknown IDs) is not verified.
   */
  const isUserEmailVerified = (userId: string) =>
    INVITED_USERS.some((u) => u.userId === userId) || store.accounts.isEmailVerified(userId);

  // Sean: email verification before pre-grade estimates. Signed-up accounts must confirm the
  // emailed code first; invite testers (no account row) and pre-0017 accounts count as verified.
  // Internal grade-job calls were checked when the job was created.
  app.use("/v1/*", async (c, next) => {
    if (c.req.method !== "POST" || !requiresVerifiedEmail(c.req.path) || c.get("internalOwner")) return next();
    if (isUserEmailVerified(c.get("userId"))) return next();
    return c.json({ ok: false, error: EMAIL_UNVERIFIED_CODE, message: EMAIL_VERIFICATION_COPY.required }, 403);
  });

  // Sean (Oct 17): accounts are 18+, stated at sign-up (no birth date). Guests state nothing,
  // so they never get CardSight (see the scan route).
  const ageGate = options.ageGate ?? ageGateEnabledFromEnv();
  const termsGate = options.termsGate ?? termsGateEnabledFromEnv();
  const termsRequired = (c: Context) =>
    c.json({ ok: false, error: TERMS_REQUIRED_CODE, message: TERMS_COPY.required }, 400);
  const termsAcceptedIn = (body: Record<string, unknown>) => body.termsAccepted === true && body.termsVersion === TERMS_VERSION;
  /**
   * Accounts from before the Terms (or an older version) accept them on their next sign-in:
   * null = OK (recorded now if accepted in this request), otherwise the terms_required answer.
   */
  const termsGateForSignIn = (c: Context, account: { userId: string; termsVersion?: string | null }, body: Record<string, unknown>) => {
    if (!termsGate || account.termsVersion === TERMS_VERSION) return null;
    if (termsAcceptedIn(body)) {
      store.accounts.setTermsAcceptance(account.userId, TERMS_VERSION, now().toISOString());
      return null;
    }
    return termsRequired(c);
  };
  /**
   * Sean (Oct 21): CardSight consent is part of the Terms accepted at sign-up (no separate prompt).
   * Allowed = account accepted the current Terms version, unless the user turned CardSight off in
   * Settings > Card recognition (a withdrawal or decline that wasn't re-granted).
   */
  const cardSightConsented = (userId: string): boolean => {
    if (isGuestUserId(userId)) return false;
    // Settings > Card recognition switched on (current version) always counts.
    if (hasActiveConsent(store.consents, userId)) return true;
    const record = store.consents.get(userId, "cardsight");
    if (record && (record.withdrawnAt || record.declinedAt)) return false; // turned off in Settings
    const account = store.accounts.getAccount(userId);
    return account?.termsVersion === TERMS_VERSION;
  };
  const cardSightConsentView = (userId: string) => {
    const state = consentState(store.consents.get(userId, "cardsight"));
    return { ...state, granted: cardSightConsented(userId), needsPrompt: false };
  };
  const ageRequired = (c: Context) =>
    c.json({ ok: false, error: AGE_CONFIRMATION_REQUIRED_CODE, message: AGE_GATE_COPY.required }, 400);

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
    const db = storePing(store);
    const ok = healthOk(gradeEngine) && (db?.ok ?? true);
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
        ...(db ? { db } : {}),
        backups: { litestream: litestreamModeFromEnv() },
      },
      ok ? 200 : 503,
    );
  });

  registerStatusRoutes(app, {
    cacheMs: options.statusCacheMs,
    features: () => ({ livestream: livestreamEnabled() }),
    inputs: async () => {
      const engine = gradeEngineProbe ? await boundedProbe(gradeEngineProbe) : null;
      return {
        pricingProvider: pricingProviderHealth(pricing.name),
        gradeEstimate: gradeEstimateHealth(gradingProvider.name),
        gradeEngineOk: engine ? healthOk(engine) : null,
        recognitionMock: recognitionProvider.name === "mock",
        opsMessage: process.env.CARD_FLOW_STATUS_MESSAGE ?? null,
      };
    },
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

  /**
   * Sean (Oct 18/19): livestream is signed-in + 18+, free for 3 days from account creation, then Premium.
   * Oct 21: frames go to CardSight (masked) only with current CardSight consent; see liveCardSightIdentify.
   * After the trial: 403 premium_required; the app shows a subscribe paywall (IAP stub until StoreKit).
   */
  const accountCreatedAtForLivestream = (userId: string): string | null => {
    const account = store.accounts.getAccount(userId);
    if (account?.createdAt) return account.createdAt;
    // Invited/dev users without user_accounts: grade anchor is "first seen" and starts the window.
    const grade = getGradeAccount(userId);
    if (grade.anchorAt) return grade.anchorAt;
    return store.ensureGradeAnchor(userId, now().toISOString()).anchorAt ?? null;
  };
  const livestreamAccessSnapshot = (userId: string): LivestreamAccess => {
    const premium = resolveAccountPlan(userId, getGradeAccount(userId).plan) === "premium";
    return livestreamAccessFor({
      premium,
      accountCreatedAt: accountCreatedAtForLivestream(userId),
      now: now(),
    });
  };
  const ensureLivestreamAccess = (c: Context) => {
    const userId = c.get("userId") as string;
    if (isGuestUserId(userId)) return { ok: false as const, response: signupRequired(c, "scan") };
    if (!hasAgeConfirmation(store.ageConfirmations, userId)) return { ok: false as const, response: ageRequired(c) };
    const access = livestreamAccessSnapshot(userId);
    if (!livestreamAccessAllowed(access)) {
      return { ok: false as const, response: c.json(premiumRequiredBody("livestream_scanner"), 403) };
    }
    return { ok: true as const, access };
  };

  app.get("/v1/livestream/access", (c) => {
    const userId = c.get("userId") as string;
    if (isGuestUserId(userId)) return signupRequired(c, "scan");
    if (!hasAgeConfirmation(store.ageConfirmations, userId)) return ageRequired(c);
    return c.json({ ok: true as const, access: livestreamAccessSnapshot(userId) });
  });

  app.get("/v1/livestream/guesses/:tcgdexId", async (c) => {
    const gate = ensureLivestreamAccess(c);
    if (!gate.ok) return gate.response;
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

  const normalizeCropInFrame = (raw: unknown): NormRect | null => {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const v = [r.x, r.y, r.width, r.height];
    if (!v.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) return null;
    return { x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number };
  };

  const liveCardSightIdentify = async (
    c: Context,
    input: {
      cardDetected: boolean;
      identityHash: string | null;
      identityCropJpeg: string | null;
      identityCropQuad: number[] | null;
      cropInFrame: NormRect | null;
      sessionId: string | null;
      inHouse: LiveVideoIdentityResult;
      inHouseTcgdexId: string | null;
      inHouseCandidates: { tcgdexId: string; similarity: number }[];
      inHouseMs: number | null;
      accessState: string;
    },
  ): Promise<{ identity: LiveVideoIdentityResult; extras: Record<string, unknown> }> => {
    const userId = c.get("userId") as string;
    const pipeline = input.inHouse.pipeline;
    const quiet = (reason: LiveVideoIdentityResult["reason"], extras: Record<string, unknown> = {}) => ({
      identity: { tcgdexId: null, confidence: null, reason, pipeline },
      extras: { source: "cardsight", ...extras },
    });
    const shownAs = (tcgdexId: string, confidence: "High" | "Medium", engine: "in_house" | "cardsight") => ({
      identity: { tcgdexId, confidence, reason: "identified" as const, pipeline },
      extras: { source: "cardsight", engine },
    });
    // Terms 3(b) of CardSight: no dataset from its outputs. This log holds only the engine, the
    // CardSight confidence tier, timings and OUR matcher's output. No CardSight card ids.
    const logEngine = (entry: { engine: string; tier?: string | null; cardSightMs?: number; cached?: boolean }) => {
      console.info(
        `[livestream-engine] ${JSON.stringify({
          ...entry,
          inHouse: input.inHouseTcgdexId,
          inHouseSimilarity: input.inHouseCandidates[0]?.similarity ?? null,
          inHouseMs: input.inHouseMs,
        })}`,
      );
    };
    if (!input.cardDetected) return quiet("no_card");

    // Hybrid (Sean, Oct 21): a confident in-house match is shown at once and CardSight isn't called.
    const key = input.identityHash ? `hash:${input.identityHash}` : null;
    if (inHouseConfident({ tcgdexId: input.inHouseTcgdexId, candidates: input.inHouseCandidates }, liveInHouseGate)) {
      const id = input.inHouseTcgdexId!;
      logEngine({ engine: "in_house" });
      return shownAs(id, "High", "in_house");
    }

    // CardSight is covered by the Terms (unless turned off in Settings). Otherwise: in-house only.
    if (!cardSightConsented(userId)) return quiet("unidentified");
    const crop = decodeIdentityCropJpeg(input.identityCropJpeg);
    if (!crop) return quiet("unidentified");
    const cardKey = key ?? `crop:${createHash("sha256").update(crop.bytes).digest("hex")}`;
    // One CardSight call per card: the same card still in view is answered from memory (in-process,
    // short-lived, only to serve this user), never re-sent.
    const recalled = liveCardSightGate.recall(userId, cardKey);
    if (recalled) {
      logEngine({ engine: "cardsight", tier: recalled.confidence, cached: true });
      return recalled.tcgdexId
        ? shownAs(recalled.tcgdexId, recalled.confidence ?? "Medium", "cardsight")
        : quiet("unidentified", recalled.hint ? { hint: recalled.hint } : {});
    }
    const t = now();
    const day = utcDayKey(t);
    const month = utcMonthKey(t);
    const limits = liveCardSightLimits;
    // Above the monthly cap: in-house only (it already wasn't confident, so nothing is shown).
    const monthlyCap = input.accessState === "premium" ? limits.premiumMonthly : limits.trialMonthly;
    if (store.getVendorQuotaUsage(liveCardSightUserMonthMeter(userId), month) >= monthlyCap) {
      logEngine({ engine: "in_house_only_monthly_cap" });
      return quiet("unidentified", { limited: "user_monthly" });
    }
    if (store.getVendorQuotaUsage(LIVE_CARDSIGHT_GLOBAL_METER, day) >= limits.globalDaily) {
      return quiet("unidentified", { limited: "global_daily" });
    }
    if (store.getVendorQuotaUsage(liveCardSightUserMeter(userId), day) >= limits.perUserDaily) {
      return quiet("unidentified", { limited: "user_daily" });
    }
    if (!liveCardSightGate.takeSessionSlot(`${userId}:${input.sessionId ?? "default"}`)) {
      return quiet("unidentified", { limited: "session" });
    }
    // Black out Whatnot chat / bid overlays and anything outside the card before it leaves us.
    const masked = maskLiveCrop(crop.bytes, {
      quad: input.identityCropQuad,
      cropInFrame: input.cropInFrame,
      regions: liveMaskRegions,
    });
    if (!masked) return quiet("unidentified");
    const started = performance.now();
    let result: CardFlowNormalizedRecognitionResult | null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Hard deadline keeps card-appears-to-result inside the ~7 s budget.
      result = await Promise.race([
        options.cardSight!.identifyCard({ image: masked, mimeType: "image/jpeg" }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), limits.deadlineMs);
        }),
      ]);
    } catch {
      result = null;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const cardSightMs = Math.round(performance.now() - started);
    if (!result) {
      logEngine({ engine: "cardsight", tier: "timeout", cardSightMs });
      return quiet("unidentified");
    }
    if (!result.ok) return quiet("unidentified");
    // Charge the meters only for a successful (billable) response.
    store.consumeVendorQuota(liveCardSightUserMonthMeter(userId), month, monthlyCap);
    store.consumeVendorQuota(liveCardSightUserMeter(userId), day, limits.perUserDaily);
    if (store.consumeVendorQuota(LIVE_CARDSIGHT_GLOBAL_METER, day, limits.globalDaily)) {
      metrics.recordLiveCardSightDailyUsage(
        store.getVendorQuotaUsage(LIVE_CARDSIGHT_GLOBAL_METER, day),
        limits.globalDaily,
        day,
      );
    }
    const verdict = liveCardSightVerdict(result);
    let row: { tcgdexId: string | null; confidence: "High" | "Medium" | null; hint: typeof LIVE_ONE_CARD_HINT | null } = {
      tcgdexId: null,
      confidence: null,
      hint: verdict.kind === "multi_card" || verdict.kind === "non_english" ? LIVE_ONE_CARD_HINT : null,
    };
    if (verdict.kind === "identified") {
      const mapped = await recognitionWithMultiCardMappings({ ...result, detections: [verdict.detection] }, catalog);
      const tcgdexId = normalizeLiveVideoTcgdexId(mapped.mapping.tcgdexId);
      if (tcgdexId) row = { tcgdexId, confidence: verdict.detection.confidence as "High" | "Medium", hint: null };
    }
    // Low is not remembered, so the next new frame of this card may try again (still capped).
    if (verdict.kind !== "low" && verdict.kind !== "none") liveCardSightGate.remember(userId, cardKey, row);
    logEngine({
      engine: "cardsight",
      tier: verdict.kind === "identified" ? verdict.detection.confidence : verdict.kind,
      cardSightMs,
    });
    return row.tcgdexId
      ? shownAs(row.tcgdexId, row.confidence ?? "Medium", "cardsight")
      : quiet("unidentified", row.hint ? { hint: row.hint } : {});
  };

  app.post("/v1/livestream/identify", async (c) => {
    const gate = ensureLivestreamAccess(c);
    if (!gate.ok) return gate.response;
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
      cardBox?: unknown;
      cropInFrame?: unknown;
      sessionId?: unknown;
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
    let openclipCandidates: { tcgdexId: string; similarity: number }[] = [];
    let openclipSimilarity: number | null = null;
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
          stages.match = match.timings.searchMs ?? match.timings.totalMs;
          stages.orb = match.timings.orbMs;
        }
        warped = match?.warped === true;
        if (match?.candidates?.length) openclipCandidates = match.candidates;
        if (typeof match?.similarity === "number") openclipSimilarity = match.similarity;
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
    // Sean (Oct 21): with CardSight on, the in-house result is hidden (comparison log only) and
    // the shown identity comes from CardSight at Medium/High confidence, or nothing.
    let extras: Record<string, unknown> = {
      ...(openclipCandidates.length ? { candidates: openclipCandidates } : {}),
      ...(openclipSimilarity != null ? { similarity: openclipSimilarity } : {}),
    };
    let shown = identity;
    if (liveCardSightOn && options.cardSight) {
      const live = await liveCardSightIdentify(c, {
        cardDetected,
        identityHash,
        identityCropJpeg,
        identityCropQuad,
        cropInFrame: normalizeCropInFrame(body.cropInFrame ?? body.cardBox),
        sessionId: typeof body.sessionId === "string" ? body.sessionId.slice(0, 64) : null,
        inHouse: identity,
        inHouseTcgdexId: openclipTcgdexId,
        inHouseCandidates: openclipCandidates,
        inHouseMs: stages.sidecar != null ? Math.round(stages.sidecar) : null,
        accessState: gate.access.state,
      });
      shown = live.identity;
      extras = live.extras;
    }
    if (!livestreamTiming) return c.json({ ok: true, identity: shown, ...extras });
    stages.server = performance.now() - startedAt;
    const sample: LiveScanSample = {
      stages,
      outcome: shown.reason === "identified" ? "accepted" : "rejected",
      warped,
    };
    livestreamTimingLog.add(sample);
    console.info(`[livestream-timing] ${JSON.stringify({ ...sample, tcgdexId: shown.tcgdexId })}`);
    return c.json({ ok: true, identity: shown, timing: { stages, warped }, ...extras });
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
      if (!saved) return c.json({ ok: false, error: "Couldn't submit copy" }, 400);
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
      if (!saved) return c.json({ ok: false, error: "Couldn't mark returned" }, 400);
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

  /** Fixed-window limiter for auth routes. Keys are pruned as they expire. */
  const authHits = new Map<string, { windowStart: number; count: number }>();
  const overLimit = (key: string, limit: number, windowMs: number): boolean => {
    const nowMs = now().getTime();
    if (authHits.size > 10_000) {
      for (const [k, v] of authHits) if (nowMs - v.windowStart >= 60 * 60 * 1000) authHits.delete(k);
    }
    const hit = authHits.get(key);
    if (!hit || nowMs - hit.windowStart >= windowMs) {
      authHits.set(key, { windowStart: nowMs, count: 1 });
      return false;
    }
    hit.count += 1;
    return hit.count > limit;
  };
  /** Peek without counting (H1: only failed sign-ins count). */
  const isLimited = (key: string, limit: number, windowMs: number): boolean => {
    const hit = authHits.get(key);
    return Boolean(hit && now().getTime() - hit.windowStart < windowMs && hit.count >= limit);
  };
  const authLimits = {
    signupPerIp: options.authLimits?.signupPerIp ?? 10,
    signInPerIp: options.authLimits?.signInPerIp ?? 30,
    perEmail: options.authLimits?.perEmail ?? 10,
    invitePerIp: options.authLimits?.invitePerIp ?? 20,
  };
  const tooMany = (c: Context) => {
    c.header("Retry-After", "900");
    return c.json({ ok: false, error: ACCOUNT_AUTH_COPY.tooMany }, 429);
  };

  // Backend review M4: invite-code sign-in is rate-limited per IP (codes are guessable otherwise).
  app.post("/v1/sessions", async (c) => {
    const inviteIp = clientIp(c, trustProxyHops, socketAddress) ?? "unknown";
    if (overLimit(`invite-ip:${inviteIp}`, authLimits.invitePerIp, 15 * 60 * 1000)) return tooMany(c);
    const body = await c.req.json<{ inviteCode?: unknown }>().catch(() => ({}) as { inviteCode?: unknown });
    if (typeof body.inviteCode !== "string" || body.inviteCode.trim() === "") {
      return c.json({ ok: false, error: "Unknown invite code" }, 400);
    }
    const identity = identityForInviteCode(body.inviteCode);
    if (!identity) {
      return c.json({ ok: false, error: "Unknown invite code" }, 401);
    }
    const created = createSession(identity.userId);
    await bindPokecollectorUser(created.identity);
    // Signing in from a guest session keeps the guest's scans (moved in one transaction).
    adoptGuestData(c.req.header("authorization"), identity.userId);
    return c.json({
      ok: true,
      token: created.token,
      identity: created.identity,
      invitedUsers: [created.identity],
    });
  });

  const readCredentials = async (c: Context) => {
    const body = await c.req.json<{ email?: unknown; password?: unknown }>().catch(() => ({}) as Record<string, unknown>);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    return { email, password };
  };
  const accountSession = (account: { userId: string; email: string }) => {
    const minted = store.accounts.mintSession(account.userId, {
      guest: false,
      at: now().toISOString(),
      expiresAt: sessionExpiryIso(now()),
    });
    const identity = { userId: account.userId, label: account.email };
    return { token: minted.token, identity };
  };

  app.post("/v1/accounts", async (c) => {
    const ip = clientIp(c, trustProxyHops, socketAddress) ?? "unknown";
    if (overLimit(`signup-ip:${ip}`, authLimits.signupPerIp, 60 * 60 * 1000)) return tooMany(c);
    const { email, password } = await readCredentials(c);
    if (!isValidEmail(email)) return c.json({ ok: false, error: ACCOUNT_AUTH_COPY.badEmail }, 400);
    if (overLimit(`email:${email}`, authLimits.perEmail, 15 * 60 * 1000)) return tooMany(c);
    const problem = passwordProblem(password);
    if (problem) return c.json({ ok: false, error: problem }, 400);
    // Sean (Oct 17): sign-up states 18+ (required checkbox). Stored: confirmation, time, version.
    const signUpBody = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const bodyConfirmed = signUpBody.ageConfirmed18Plus === true && signUpBody.ageGateVersion === AGE_GATE_VERSION;
    if (ageGate && !bodyConfirmed) return ageRequired(c);
    const termsAccepted = termsAcceptedIn(signUpBody);
    const existingForEmail = store.accounts.findByEmail(email);
    // A new account must accept the Terms (an existing email just signs in below).
    if (termsGate && !termsAccepted && !existingForEmail) return termsRequired(c);
    const passwordHash = await hashPassword(password);
    const signUpAt = now().toISOString();
    const created = store.accounts.createAccount({
      email,
      passwordHash,
      at: signUpAt,
      ...(termsAccepted ? { terms: { version: TERMS_VERSION, acceptedAt: signUpAt } } : {}),
    });
    let account = created;
    if (!account) {
      // Email already registered: the right password signs in; anything else gets one generic answer.
      const existing = store.accounts.findByEmail(email);
      if (!existing || !(await verifyPassword(password, existing.passwordHash))) {
        return c.json({ ok: false, error: ACCOUNT_AUTH_COPY.signUpFailed }, 400);
      }
      const needTerms = termsGateForSignIn(c, existing, signUpBody);
      if (needTerms) return needTerms;
      account = existing;
    }
    if (created) {
      sendVerificationCode(created);
      // Carry over this month's used allowances from a live tombstone (HMAC match). No new-account bonus.
      const tomb = store.accounts.findAllowanceTombstone(allowanceTombstoneKey(created.email));
      if (tomb) {
        const ageMs = now().getTime() - Date.parse(tomb.deletedAt);
        if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= ALLOWANCE_TOMBSTONE_TTL_MS) {
          const { period } = quotaPeriodForUser(created.userId, now());
          if (tomb.periodKey === period.key && tomb.used > 0) {
            store.setGradeQuotaUsage(created.userId, period.key, tomb.used);
          }
        }
      }
    }
    const moved = adoptGuestData(c.req.header("authorization"), account.userId);
    if (bodyConfirmed && !hasAgeConfirmation(store.ageConfirmations, account.userId)) {
      store.ageConfirmations.confirm(account.userId, AGE_GATE_VERSION, now().toISOString());
    }
    const session = accountSession(account);
    return c.json({
      ok: true as const,
      ...session,
      invitedUsers: [session.identity],
      movedScans: moved?.scans ?? 0,
      emailVerified: isUserEmailVerified(account.userId),
    });
  });

  // Sean (Oct 19): Sign in with Apple / Google. Each is off until configured (see social-auth.ts).
  const socialConfig = options.socialAuth?.config ?? socialAuthConfigFromEnv();
  const socialVerifier = options.socialAuth?.verifier ?? createJwksSocialVerifier(socialConfig);
  // Apple is offered only with the key that lets account deletion revoke the Apple token.
  const appleTokens: AppleTokenClient | null = options.socialAuth
    ? (options.socialAuth.apple ?? null)
    : (() => {
        const cfg = appleKeyConfigFromEnv();
        return cfg ? createAppleTokenClient(cfg) : null;
      })();
  const providerOn = (p: SocialProvider) => socialProviderEnabled(socialConfig, p) && (p !== "apple" || appleTokens !== null);
  if (socialProviderEnabled(socialConfig, "apple") && !appleTokens) {
    console.warn("[auth] CARD_FLOW_APPLE_SIGNIN is on but the Apple key (TEAM_ID/KEY_ID/PRIVATE_KEY) is missing: Apple sign-in stays off.");
  }
  /** Fire-and-forget: revoke Apple tokens before the rows go (App Review 5.1.1(v)). */
  const revokeSocialTokens = (userId: string) => {
    if (!appleTokens) return;
    for (const { provider, sealed } of store.accounts.listSocialRefreshTokens(userId)) {
      const token = provider === "apple" ? openToken(sealed) : null;
      if (token) void appleTokens.revoke(token).catch((err) => console.warn("[auth] Apple revoke failed", String(err)));
    }
  };
  app.get("/v1/auth/providers", (c) =>
    c.json({
      ok: true as const,
      apple: providerOn("apple"),
      google: providerOn("google"),
    }),
  );
  app.post("/v1/sessions/social", async (c) => {
    const ip = clientIp(c, trustProxyHops, socketAddress) ?? "unknown";
    if (overLimit(`social-ip:${ip}`, authLimits.signupPerIp, 60 * 60 * 1000)) return tooMany(c);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const provider = body.provider === "apple" || body.provider === "google" ? (body.provider as SocialProvider) : null;
    const idToken = typeof body.idToken === "string" ? body.idToken : "";
    if (!provider || !idToken) return c.json({ ok: false, error: "Bad request" }, 400);
    if (!providerOn(provider)) return c.json({ ok: false, error: "Not found" }, 404);
    let verified;
    try {
      verified = await socialVerifier({ provider, idToken, nonce: typeof body.nonce === "string" ? body.nonce : null });
    } catch {
      return c.json({ ok: false, error: ACCOUNT_AUTH_COPY.signInFailed }, 401);
    }
    const at = now().toISOString();
    const storeAppleCode = async () => {
      const code = typeof body.authorizationCode === "string" ? body.authorizationCode : "";
      if (provider !== "apple" || !code || !appleTokens) return;
      const refresh = await appleTokens.exchangeCode(code).catch(() => null);
      if (refresh) store.accounts.setSocialRefreshToken("apple", verified.subject, sealToken(refresh));
    };
    const finish = async (account: { userId: string; email: string }, created: boolean) => {
      await storeAppleCode();
      const session = accountSession(account);
      const fresh = store.accounts.getAccount(account.userId);
      return c.json({
        ok: true as const,
        ...session,
        invitedUsers: [session.identity],
        movedScans: 0,
        emailVerified: isUserEmailVerified(account.userId),
        hasPassword: Boolean(fresh && fresh.passwordHash !== NO_PASSWORD_HASH),
        created,
      });
    };
    // 1) Already linked: sign in.
    const linkedUserId = store.accounts.findUserBySocial(provider, verified.subject);
    if (linkedUserId) {
      const account = store.accounts.getAccount(linkedUserId);
      if (!account) return c.json({ ok: false, error: ACCOUNT_AUTH_COPY.signInFailed }, 401);
      const needTerms = termsGateForSignIn(c, account, body);
      if (needTerms) return needTerms;
      return finish(account, false);
    }
    // Linking or creating needs an email the provider verified.
    const email = verified.email?.trim().toLowerCase() ?? "";
    if (!verified.emailVerified || !isValidEmail(email)) {
      return c.json({ ok: false, code: "email_unverified", error: ACCOUNT_AUTH_COPY.signInFailed }, 401);
    }
    // 2) Existing account with this verified email: link and sign in.
    const existing = store.accounts.findByEmail(email);
    if (existing) {
      const needTerms = termsGateForSignIn(c, existing, body);
      if (needTerms) return needTerms;
      if (!isUserEmailVerified(existing.userId)) {
        // Mobile Tech Lead (PR 113): an unverified email/password account may have been created by
        // someone else with this address. The provider proved ownership, so it takes over: the
        // password is cleared and every session is signed out before the link.
        store.accounts.setPasswordHash(existing.userId, NO_PASSWORD_HASH);
        store.accounts.deleteSessionsForUser(existing.userId);
      }
      store.accounts.linkSocial({ provider, subject: verified.subject, userId: existing.userId, email, at });
      store.accounts.markEmailVerified(existing.userId, at);
      return finish(existing, false);
    }
    // 3) New account: the Terms checkbox and the 18+ statement come first (nothing is created without them).
    const ageOk = body.ageConfirmed18Plus === true && body.ageGateVersion === AGE_GATE_VERSION;
    const termsOk = termsAcceptedIn(body);
    if ((ageGate && !ageOk) || (termsGate && !termsOk)) {
      return c.json(
        { ok: false, error: "signup_details_required", needs: { age: ageGate && !ageOk, terms: termsGate && !termsOk } },
        400,
      );
    }
    const created = store.accounts.createAccount({
      email,
      passwordHash: NO_PASSWORD_HASH,
      at,
      emailVerified: true,
      ...(termsOk ? { terms: { version: TERMS_VERSION, acceptedAt: at } } : {}),
    });
    if (!created) return c.json({ ok: false, error: ACCOUNT_AUTH_COPY.signInFailed }, 400);
    store.accounts.linkSocial({ provider, subject: verified.subject, userId: created.userId, email, at });
    if (ageOk) store.ageConfirmations.confirm(created.userId, AGE_GATE_VERSION, at);
    return finish(created, true);
  });

  app.post("/v1/sessions/password", async (c) => {
    const ip = clientIp(c, trustProxyHops, socketAddress) ?? "unknown";
    const { email, password } = await readCredentials(c);
    // Backend review H1: only failed sign-ins count, keyed by email + IP (and per IP overall),
    // so a stranger can't lock someone out of their account from another network.
    const failKey = `signin-fail:${email}:${ip}`;
    const ipFailKey = `signin-fail-ip:${ip}`;
    const window = 15 * 60 * 1000;
    if (isLimited(failKey, authLimits.perEmail, window) || isLimited(ipFailKey, authLimits.signInPerIp, window)) return tooMany(c);
    const existing = email ? store.accounts.findByEmail(email) : null;
    const ok = existing ? await verifyPassword(password, existing.passwordHash) : await verifyAgainstDummy(password);
    if (!existing || !ok) {
      overLimit(failKey, authLimits.perEmail, window);
      overLimit(ipFailKey, authLimits.signInPerIp, window);
      return c.json({ ok: false, error: ACCOUNT_AUTH_COPY.signInFailed }, 401);
    }
    const signInBody = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const needTerms = termsGateForSignIn(c, existing, signInBody);
    if (needTerms) return needTerms;
    const moved = adoptGuestData(c.req.header("authorization"), existing.userId);
    const session = accountSession(existing);
    return c.json({
      ok: true as const,
      ...session,
      invitedUsers: [session.identity],
      movedScans: moved?.scans ?? 0,
      emailVerified: isUserEmailVerified(existing.userId),
    });
  });

  /**
   * Verification and reset codes go through one provider-agnostic sender (Resend when
   * CARD_FLOW_EMAIL_SENDER=resend; otherwise the code is logged outside production only).
   * Sending never blocks or changes the HTTP answer, so timing can't reveal which emails exist.
   */
  const emailSender = options.emailSender ?? emailSenderFromEnv();
  const sendReset = options.deliverPasswordReset ?? ((email: string, token: string) => {
    void emailSender.send({
      kind: "password-reset",
      to: email,
      subject: EMAIL_VERIFICATION_COPY.resetSubject,
      text: passwordResetEmailText(token),
      code: token,
    });
  });
  // Backend review M1: reset emails count toward the address's daily cap too (still a silent 202).
  const deliverResetToken = (email: string, token: string) => {
    if (store.accounts.takeEmailSendForAddress(email, now().toISOString().slice(0, 10), EMAIL_SENDS_PER_ADDRESS_PER_DAY)) {
      sendReset(email, token);
    }
  };
  const emailCodeHash = (userId: string, code: string) => hashSessionToken(`${userId}:${code.trim()}`);
  const sendDay = () => now().toISOString().slice(0, 10);
  /**
   * A new 6-digit code (replaces any earlier one), emailed to the account. Backend review M1:
   * at most EMAIL_CODE_LIFETIME_SENDS per account and EMAIL_SENDS_PER_ADDRESS_PER_DAY per address.
   */
  const sendVerificationCode = (account: { userId: string; email: string }): "sent" | "lifetime" | "daily" => {
    if (!store.accounts.takeVerificationSend(account.userId, EMAIL_CODE_LIFETIME_SENDS)) return "lifetime";
    if (!store.accounts.takeEmailSendForAddress(account.email, sendDay(), EMAIL_SENDS_PER_ADDRESS_PER_DAY)) return "daily";
    const code = String(randomInt(0, 10 ** EMAIL_CODE_LENGTH)).padStart(EMAIL_CODE_LENGTH, "0");
    const at = now();
    store.accounts.createEmailVerification({
      userId: account.userId,
      codeHash: emailCodeHash(account.userId, code),
      at: at.toISOString(),
      expiresAt: new Date(at.getTime() + EMAIL_VERIFICATION_TTL_MS).toISOString(),
    });
    void emailSender.send({
      kind: "verify-email",
      to: account.email,
      subject: EMAIL_VERIFICATION_COPY.emailSubject,
      text: verificationEmailText(code),
      code,
    });
    return "sent";
  };

  // Policy Reviewer (Oct 17): testers and existing accounts confirm 18+ once in the app before
  // any CardSight call. Accounts only: guests are refused by the guest gate (signup_required).
  app.get("/v1/age-confirmation", (c) => {
    const userId = c.get("userId");
    const record = isGuestUserId(userId) ? null : store.ageConfirmations.get(userId);
    return c.json({ ok: true as const, age: ageConfirmationState(record) });
  });
  app.post("/v1/age-confirmation", async (c) => {
    const userId = c.get("userId");
    if (isGuestUserId(userId)) return signupRequired(c, "cardsight");
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    if (body.ageConfirmed18Plus !== true) return c.json({ ok: false, error: "ageConfirmed18Plus must be true" }, 400);
    if (body.version !== AGE_GATE_VERSION) {
      return c.json({ ok: false, error: "Reload and try again.", currentVersion: AGE_GATE_VERSION }, 409);
    }
    store.ageConfirmations.confirm(userId, AGE_GATE_VERSION, now().toISOString());
    return c.json({ ok: true as const, age: ageConfirmationState(store.ageConfirmations.get(userId)) });
  });

  // Sean: CardSight disclosure + consent, stored with its version and timestamps.
  app.get("/v1/consents/cardsight", (c) =>
    c.json({ ok: true as const, consent: cardSightConsentView(c.get("userId")) }),
  );
  app.post("/v1/consents/cardsight", async (c) => {
    const userId = c.get("userId");
    // Policy Reviewer (Oct 17): guests never get CardSight, so they can't give consent either.
    if (isGuestUserId(userId)) return signupRequired(c, "cardsight");
    const body = await c.req.json<{ granted?: unknown; version?: unknown }>().catch(() => ({}) as Record<string, unknown>);
    if (typeof body.granted !== "boolean") return c.json({ ok: false, error: "granted must be true or false" }, 400);
    const at = now().toISOString();
    if (body.granted) {
      // Agreeing counts only for the wording the user saw: the current version.
      if (body.version !== CARDSIGHT_CONSENT_VERSION) {
        return c.json({ ok: false, error: "Consent version is out of date. Reload and try again.", currentVersion: CARDSIGHT_CONSENT_VERSION }, 409);
      }
      store.consents.grant(userId, "cardsight", CARDSIGHT_CONSENT_VERSION, at);
    } else if (hasActiveConsent(store.consents, userId)) {
      store.consents.withdraw(userId, "cardsight", at);
    } else {
      // Sean (Oct 21): consent comes from the Terms; turning it off in Settings is recorded as a decline.
      store.consents.decline(userId, "cardsight", CARDSIGHT_CONSENT_VERSION, at);
    }
    return c.json({ ok: true as const, consent: cardSightConsentView(userId) });
  });

  app.post("/v1/email-verifications", (c) => {
    const userId = c.get("userId");
    const account = store.accounts.getAccount(userId);
    if (!account || isUserEmailVerified(userId)) return c.json({ ok: true as const, emailVerified: true });
    // One code per minute (the resend button) and at most 5 an hour per account.
    if (isLimited(`verify-send-min:${userId}`, 1, EMAIL_RESEND_COOLDOWN_MS)) {
      return c.json({ ok: false, error: EMAIL_VERIFICATION_COPY.tooSoon }, 429);
    }
    if (overLimit(`verify-send-hour:${userId}`, 5, 60 * 60 * 1000)) return tooMany(c);
    overLimit(`verify-send-min:${userId}`, 1, EMAIL_RESEND_COOLDOWN_MS);
    const sent = sendVerificationCode(account);
    if (sent === "lifetime") return c.json({ ok: false, error: EMAIL_VERIFICATION_COPY.sendLimit }, 429);
    if (sent === "daily") return c.json({ ok: false, error: EMAIL_VERIFICATION_COPY.dailyLimit }, 429);
    return c.json(
      { ok: true as const, emailVerified: false, message: EMAIL_VERIFICATION_COPY.sent, resendAfterMs: EMAIL_RESEND_COOLDOWN_MS },
      202,
    );
  });

  app.post("/v1/email-verifications/confirm", async (c) => {
    const userId = c.get("userId");
    if (!store.accounts.getAccount(userId) || isUserEmailVerified(userId)) {
      return c.json({ ok: true as const, emailVerified: true as const });
    }
    // Per-code tries are capped in the store (5); this caps guessing across new codes too.
    if (overLimit(`verify-confirm:${userId}`, 20, 60 * 60 * 1000)) return tooMany(c);
    const body = await c.req.json<{ code?: unknown }>().catch(() => ({}) as Record<string, unknown>);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const result = isEmailCode(code)
      ? store.accounts.confirmEmailVerification(userId, emailCodeHash(userId, code), now().toISOString())
      : "invalid";
    if (result !== "verified") return c.json({ ok: false, error: EMAIL_VERIFICATION_COPY.invalid }, 400);
    return c.json({ ok: true as const, emailVerified: true as const, message: EMAIL_VERIFICATION_COPY.verified });
  });

  app.post("/v1/password-resets", async (c) => {
    const ip = clientIp(c, trustProxyHops, socketAddress) ?? "unknown";
    if (overLimit(`reset-ip:${ip}`, authLimits.signInPerIp, 15 * 60 * 1000)) return tooMany(c);
    const body = await c.req.json<{ email?: unknown }>().catch(() => ({}) as Record<string, unknown>);
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const generic = { ok: true as const, message: ACCOUNT_AUTH_COPY.resetRequested };
    if (!isValidEmail(email)) return c.json(generic, 202);
    if (overLimit(`reset-email:${email}`, authLimits.perEmail, 60 * 60 * 1000)) return c.json(generic, 202);
    const account = store.accounts.findByEmail(email);
    if (account) {
      const token = randomBytes(32).toString("base64url");
      const at = now();
      store.accounts.createPasswordReset({
        userId: account.userId,
        tokenHash: hashSessionToken(token),
        at: at.toISOString(),
        expiresAt: new Date(at.getTime() + PASSWORD_RESET_TTL_MS).toISOString(),
      });
      deliverResetToken(account.email, token);
    }
    return c.json(generic, 202);
  });
  app.post("/v1/password-resets/confirm", async (c) => {
    const ip = clientIp(c, trustProxyHops, socketAddress) ?? "unknown";
    if (overLimit(`reset-confirm-ip:${ip}`, authLimits.signInPerIp, 15 * 60 * 1000)) return tooMany(c);
    const body = await c.req.json<{ token?: unknown; password?: unknown }>().catch(() => ({}) as Record<string, unknown>);
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const problem = passwordProblem(password);
    if (problem) return c.json({ ok: false, error: problem }, 400);
    const userId = token ? store.accounts.consumePasswordReset(hashSessionToken(token), now().toISOString()) : null;
    if (!userId) return c.json({ ok: false, error: ACCOUNT_AUTH_COPY.resetInvalid }, 400);
    store.accounts.setPasswordHash(userId, await hashPassword(password));
    // Every existing session (possibly an attacker's) is signed out.
    store.accounts.deleteSessionsForUser(userId);
    return c.json({ ok: true as const });
  });

  /**
   * Backend re-review H1/M1 (P4): what PokeSniper stored on PokéCollector is deleted by a
   * background queue (pokecollector-deletion-queue.ts): the remote user ID is queued in the same
   * transaction as the account's rows, retried with backoff, paced under PokéCollector's limits,
   * and the delete response never waits on PokéCollector. Guests and shared remote users are
   * queued as "hold" (never deleted here; the opaque-accounts relink freezes them).
   */
  const pokecollectorDeletions = createPokecollectorDeletionQueue({
    accounts: store.accounts,
    pokecollector: () => pokecollectorAccounts,
    linksTo: (remoteUserId) => store.countPokecollectorLinks(remoteUserId),
    now,
    pacer: options.pokecollectorPacer,
    // Backend final review R3: gave up after the max attempts. Logged (PokéCollector's numeric ID
    // only, never a PokeSniper user ID or email) and alerted.
    onGaveUp: ({ remoteUserId, attempts, lastResult }) => {
      console.warn(`[pokecollector-deletion] gave up on remote user ${remoteUserId} after ${attempts} attempts (${lastResult})`);
      metrics.recordPokecollectorDeletionFailed();
    },
  });
  // R3: counts of failed and stuck deletions, same token rule as /ops/metrics. No IDs.
  app.get("/ops/pokecollector-deletions", (c) => {
    const expected = opsToken?.trim();
    const given = c.req.header("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (!expected) return c.json({ ok: false, error: "Not found" }, 404);
    if (!given || !timingSafeEqualString(given, expected)) return c.json({ ok: false, error: "Unauthorized" }, 401);
    return c.json({ ok: true, ...pokecollectorDeletionCounts(store.accounts.listPokecollectorDeletions(), now()) });
  });
  options.onPokecollectorDeletionQueue?.(pokecollectorDeletions);
  if (options.pokecollectorDeletionIntervalMs !== 0) {
    const deletionTimer = setInterval(() => {
      pokecollectorDeletions.run().catch(() => undefined);
    }, options.pokecollectorDeletionIntervalMs ?? 60 * 1000);
    deletionTimer.unref?.();
  }

  /**
   * Everything for one user: rows (one transaction), then files, then staged uploads.
   * `activeWeeksCounted`: re-review edge case. When the orphan sweep deletes rows that showed up
   * after the account was already deleted (a purchase or scan in flight), the account's active
   * weeks were counted at its first delete, so only the stray purchases and scans are added.
   */
  const deleteUserEverything = (userId: string, kind: DeletionAuditKind, deleteOptions: { activeWeeksCounted?: boolean } = {}) => {
    revokeSocialTokens(userId);
    // Data Engineer review: every user_id row in one transaction first, then the files (whose
    // locations were collected before the rows went). A crash in between leaves orphan files
    // with no personal rows, which the photo retention sweep removes, never rows without files.
    // Allowance tombstone: remember this month's used grades under an HMAC of the email (no
    // plaintext) so a re-sign-up can't reset the free allowance for 90 days.
    const deletingAccount = store.accounts.getAccount(userId);
    let allowanceTombstone: { emailHmac: string; periodKey: string; used: number; deletedAt: string } | undefined;
    if (deletingAccount?.email) {
      const at = now();
      const { period } = quotaPeriodForUser(userId, at);
      allowanceTombstone = {
        emailHmac: allowanceTombstoneKey(deletingAccount.email),
        periodKey: period.key,
        used: getGradeQuotaUsage(userId, period.key),
        deletedAt: at.toISOString(),
      };
    }
    const removePhotos = store.prepareUserPhotoDeletion(userId);
    // Backend review H2 (P4): the user's weekly North Star counts become anonymous totals in the
    // same transaction that hard-deletes every row, including purchase_events, so past weeks
    // keep their numbers and nothing per-user is left (re-review L4: read inside it).
    const northStarTotals = () => {
      const totals = northStarTotalsFor(userId);
      return deleteOptions.activeWeeksCounted ? totals.map((t) => ({ ...t, activeResellers: 0 })) : totals;
    };
    // The PokéCollector link (crm_pokecollector_users) goes with every other user_id row; its
    // remote user ID is queued for deletion in that same transaction.
    const pokecollectorLink = getPokecollectorUserMapping(userId);
    // Opaque accounts: a legacy (email-derived or shared) link is held for the relink freeze, never
    // deleted here. A pending link has no remote ID yet: nothing was ever written to it, so there's
    // nothing to queue (its random password goes with the row, so nobody can sign in to it).
    const pokecollectorRemote =
      pokecollectorLink && !isPendingLink(pokecollectorLink)
        ? {
            remoteUserId: pokecollectorLink.pokecollectorUserId,
            hold: isGuestUserId(userId) || isLegacyLink(pokecollectorLink),
            at: now().toISOString(),
          }
        : undefined;
    const rows = store.accounts.deleteAllUserRows(userId, { northStarTotals, pokecollectorRemote });
    const photos = removePhotos();
    const staged = gradeUploads.releaseUser(userId);
    deleteUserGradeExtras(userId);
    let pokecollector: "not_linked" | "queued" | "held" = "not_linked";
    if (pokecollectorRemote && pokecollectorLink) {
      const queued = store.accounts.listPokecollectorDeletions().find((row) => row.remoteUserId === pokecollectorLink.pokecollectorUserId);
      pokecollector = queued?.mode === "delete" ? "queued" : "held";
      if (pokecollector === "queued") {
        pokecollectorDeletions.remember(pokecollectorLink);
        pokecollectorDeletions.kick();
      }
    }
    // Backend review M1/L1: in-flight work is refused from now on, and in-memory state goes.
    pruneDeletionMemory();
    deletedUserIds.set(userId, now().getTime());
    scanIdempotency.purgePrefix(`${userId}\0`);
    writeIdempotency.purgePrefix(`${userId}\0`);
    gradeJobRoutes?.purgeUser(userId);
    // Backend review L3: audit row with no PII.
    const rowsDeleted = Object.values(rows).reduce((sum, n) => sum + n, 0);
    store.accounts.recordDeletionAudit({ at: now().toISOString(), kind, rowsDeleted });
    if (allowanceTombstone) store.accounts.upsertAllowanceTombstone(allowanceTombstone);
    return { rows, photos, staged, rowsDeleted, pokecollector };
  };

  // Policy Reviewer (Oct 17): act on an under-18 report. Ops token only (404 when unset). Turns
  // CardSight off first (recorded as a withdrawal), signs out every session, then deletes the
  // account and all its data, same as Settings > Delete account. Body: { email } or { userId }.
  app.post("/ops/under-18-report", async (c) => {
    const expected = opsToken?.trim();
    const given = c.req.header("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (!expected) return c.json({ ok: false, error: "Not found" }, 404);
    if (!given || !timingSafeEqualString(given, expected)) return c.json({ ok: false, error: "Unauthorized" }, 401);
    const body = await c.req.json<{ email?: unknown; userId?: unknown }>().catch(() => ({}) as Record<string, unknown>);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const userId = email ? store.accounts.findByEmail(email)?.userId : typeof body.userId === "string" ? body.userId.trim() : "";
    if (!userId) return c.json({ ok: false, error: "No such account" }, 404);
    const at = now().toISOString();
    store.consents.withdraw(userId, "cardsight", at);
    store.accounts.deleteSessionsForUser(userId);
    const { photos, staged, rowsDeleted } = deleteUserEverything(userId, "under18_report");
    return c.json({
      ok: true as const,
      cardSightOff: !cardSightConsented(userId),
      photosDeleted: photos.deleted + staged,
      rowsDeleted,
    });
  });

  /**
   * Backend review M1: accounts still unverified UNVERIFIED_ACCOUNT_TTL_DAYS after sign-up are
   * deleted (every row and photo, like an account delete). Runs hourly; tests get a handle.
   */
  const purgeUnverifiedAccounts = () => {
    const cutoff = new Date(now().getTime() - UNVERIFIED_ACCOUNT_TTL_DAYS * 86_400_000).toISOString();
    const ids = store.accounts.listUnverifiedAccountsBefore(cutoff);
    for (const userId of ids) deleteUserEverything(userId, "unverified_purge");
    return { accountsPurged: ids.length };
  };
  /**
   * Backend review M1 (P4): rows and images left behind by a user that no longer exists, e.g. a
   * scan that finished after its account was deleted. Only signed-up account IDs (`acct_…`) whose
   * user_accounts row is gone, and IDs deleted in the last 24 h, are swept: invite testers and
   * guests are never touched here (guests have their own 24 h cleanup). Image files with no scan
   * row are removed once they are an hour old (a scan in flight writes its file first).
   */
  const sweepOrphanedUserData = () => {
    const at = now().toISOString();
    let accountsSwept = 0;
    // Backend re-review M1: every user_id in any table, not only users with scans.
    for (const userId of store.accounts.listAllUserIds()) {
      const goneAccount = userId.startsWith("acct_") && !store.accounts.getAccount(userId);
      if (!goneAccount && !wasDeleted(userId)) continue;
      if (store.accounts.hasLiveSession(userId, at)) continue;
      // Re-review edge: these are stray rows of an account already deleted (and counted).
      deleteUserEverything(userId, "orphan_sweep", { activeWeeksCounted: true });
      accountsSwept += 1;
    }
    const imagesSwept = store.sweepOrphanScanImages(new Date(now().getTime() - 60 * 60 * 1000));
    // Allowance tombstones older than 90 days (HMAC only; no email left).
    store.accounts.purgeAllowanceTombstonesBefore(new Date(now().getTime() - ALLOWANCE_TOMBSTONE_TTL_MS).toISOString());
    // Re-review H1: the sweep also retries due PokéCollector deletes (the queue's timer does too).
    pokecollectorDeletions.kick();
    return { accountsSwept, imagesSwept };
  };
  options.onOrphanSweep?.(sweepOrphanedUserData);
  if (options.orphanSweepIntervalMs !== 0) {
    const orphanTimer = setInterval(() => {
      try {
        sweepOrphanedUserData();
      } catch {
        // retried next tick
      }
    }, options.orphanSweepIntervalMs ?? 6 * 60 * 60 * 1000);
    orphanTimer.unref?.();
  }
  options.onUnverifiedPurge?.(purgeUnverifiedAccounts);
  if (options.unverifiedPurgeIntervalMs !== 0) {
    const purgeTimer = setInterval(() => {
      try {
        purgeUnverifiedAccounts();
      } catch {
        // retried next tick
      }
    }, options.unverifiedPurgeIntervalMs ?? 60 * 60 * 1000);
    purgeTimer.unref?.();
  }

  /**
   * Backend review M4 (P4): an account with a password must send it (`{ password }`). Guests and
   * invite-code testers have none and just confirm in the app. Wrong passwords are 403 (never 401,
   * which the app reads as "already deleted") and count toward a per-account limit.
   */
  const DELETE_PASSWORD_LIMIT = 10;
  const DELETE_PASSWORD_WINDOW_MS = 15 * 60 * 1000;
  app.post("/v1/account/delete", async (c) => {
    const userId = c.get("userId");
    const account = store.accounts.getAccount(userId);
    if (account?.passwordHash && account.passwordHash !== NO_PASSWORD_HASH) {
      const limitKey = `account-delete:${userId}`;
      if (isLimited(limitKey, DELETE_PASSWORD_LIMIT, DELETE_PASSWORD_WINDOW_MS)) return tooMany(c);
      const body = await c.req.json<{ password?: unknown }>().catch(() => ({}) as { password?: unknown });
      const password = typeof body.password === "string" ? body.password : "";
      if (!password) {
        return c.json({ ok: false, code: "password_required", error: ACCOUNT_DELETION_COPY.passwordRequired }, 403);
      }
      if (!(await verifyPassword(password, account.passwordHash))) {
        overLimit(limitKey, DELETE_PASSWORD_LIMIT, DELETE_PASSWORD_WINDOW_MS);
        return c.json({ ok: false, code: "password_incorrect", error: ACCOUNT_DELETION_COPY.passwordIncorrect }, 403);
      }
    }
    const { rows, photos, staged, rowsDeleted, pokecollector } = deleteUserEverything(userId, "self");
    const token = parseBearerToken(c.req.header("authorization"));
    if (token) deletionReceipts.set(deletionReceiptKey(token), now().getTime());
    return c.json({
      // Re-review M1: never waits on PokéCollector ("queued": deleted in the background).
      pokecollector,
      ok: true,
      photosDeleted: photos.deleted + staged,
      salesDeleted: rows.user_card_sales ?? 0,
      gradeHistoryDeleted: rows.grade_estimate_history ?? 0,
      rowsDeleted,
    });
  });

  app.get("/v1/identity", async (c) => {
    // Guests are never bound to a PokéCollector user (they all used to share `cardflow-guest`).
    if (!isGuestUserId(c.get("userId"))) await bindPokecollectorUser(c.get("identity"));
    return c.json({
      ok: true,
      identity: c.get("identity"),
      invitedUsers: [c.get("identity")],
      emailVerified: isUserEmailVerified(c.get("userId")),
      // Apple/Google-only accounts have no password (account deletion confirms by typing DELETE).
      hasPassword: (() => {
        const account = store.accounts.getAccount(c.get("userId"));
        return account ? account.passwordHash !== NO_PASSWORD_HASH : undefined;
      })(),
    });
  });

  app.patch("/v1/identity", async (c) => {
    // Backend review: invite checks share POST /v1/sessions' per-IP limiter (codes are guessable).
    const inviteIp = clientIp(c, trustProxyHops, socketAddress) ?? "unknown";
    if (overLimit(`invite-ip:${inviteIp}`, authLimits.invitePerIp, 15 * 60 * 1000)) return tooMany(c);
    const body = await c.req.json<{ inviteCode?: unknown }>().catch(() => ({}) as { inviteCode?: unknown });
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

  /**
   * Mobile Tech Lead review: queued writes send an Idempotency-Key for every kind. Routes that
   * do not mint their own deterministic row ID replay the first 2xx response for 24 h; the same
   * key with a different body is a 422; concurrent duplicates wait for the first.
   */
  const writeIdempotency = createIdempotencyRegistry<{ status: number; body: string }>(() => now().getTime());
  const replayableWrite = async (c: Context, next: () => Promise<void>) => {
    const key = c.req.header("idempotency-key")?.trim();
    if (!key) return next();
    const userId = c.get("userId") as string;
    const raw = new Uint8Array(await c.req.arrayBuffer().catch(() => new ArrayBuffer(0)));
    const bodyHash = hashRequestBody([c.req.method, c.req.path, raw]);
    const claim = writeIdempotency.claim(`${userId}\0${key}`);
    if (claim.kind === "replay") {
      const first = await claim.wait();
      if (claim.entry.bodyHash && claim.entry.bodyHash !== bodyHash) {
        return c.json({ ok: false, error: "That Idempotency-Key was already used with a different request." }, 422);
      }
      if (first) return c.body(first.body, first.status as 200, { "content-type": "application/json" });
      // The first attempt failed: run this one normally (no key reserved).
      return next();
    }
    // M3: after a restart the in-memory registry is empty; the persisted answer still replays.
    const persisted = store.idempotency.get(userId, key);
    if (persisted && now().getTime() - Date.parse(persisted.createdAt) < IDEMPOTENCY_TTL_MS) {
      claim.finish(persisted.bodyHash, { status: persisted.status, body: persisted.response });
      if (persisted.bodyHash !== bodyHash) {
        return c.json({ ok: false, error: "That Idempotency-Key was already used with a different request." }, 422);
      }
      return c.body(persisted.response, persisted.status as 200, { "content-type": "application/json" });
    }
    claim.setHash(bodyHash);
    try {
      await next();
    } catch (error) {
      claim.finish(bodyHash, undefined);
      throw error;
    }
    const res = c.res;
    if (res.status >= 200 && res.status < 300) {
      const responseBody = await res.clone().text();
      store.idempotency.prune(new Date(now().getTime() - IDEMPOTENCY_TTL_MS).toISOString());
      store.idempotency.save(userId, key, { bodyHash, status: res.status, response: responseBody, createdAt: now().toISOString() });
      claim.finish(bodyHash, { status: res.status, body: responseBody });
    } else {
      claim.finish(bodyHash, undefined);
    }
  };
  app.use("/v1/inventory/:inventoryItemId/purchased", async (c, next) => (c.req.method === "POST" ? replayableWrite(c, next) : next()));
  app.use("/v1/inventory/:inventoryItemId/purchase", async (c, next) => (c.req.method === "POST" ? replayableWrite(c, next) : next()));
  app.use("/v1/sales/:inventoryItemId", async (c, next) => (c.req.method === "GET" ? next() : replayableWrite(c, next)));
  app.use("/v1/inventory/:inventoryItemId/grade-history", async (c, next) => (c.req.method === "POST" ? replayableWrite(c, next) : next()));

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
    isPremium: (userId) => resolveAccountPlan(userId, getGradeAccount(userId).plan) === "premium",
  });

  app.post("/v1/scans", bodyLimit({
      maxSize: SCAN_IMAGE_MAX_BYTES,
      onError: (c) => c.json({ ok: false, error: "Image must be 20 MB or smaller" }, 413),
    }), async (c) => {
      const userId = c.get("userId");
      // P1-10 + backend review: the body hash must match (422 otherwise), concurrent same-key
      // requests share one run, keys last 24 h. Guests never get here (signup_required).
      const scanIdempotencyKey = c.req.header("idempotency-key")?.trim() || null;
      const regKey = scanIdempotencyKey ? `${userId}\0${scanIdempotencyKey}` : null;
      const claim = regKey ? scanIdempotency.claim(regKey) : null;
      const persistedReplay =
        claim?.kind === "new" && scanIdempotencyKey
          ? getScan(userId, scanIdForIdempotency(userId, scanIdempotencyKey))
          : undefined;
      const freshPersisted =
        persistedReplay && now().getTime() - Date.parse(persistedReplay.capturedAt) < IDEMPOTENCY_TTL_MS ? persistedReplay : undefined;
      const parsed = await parseScanCreateRequest(c);
      if ("error" in parsed) {
        if (claim?.kind === "new") claim.finish("", undefined);
        return c.json({ ok: false, error: parsed.error }, parsed.status);
      }
      const captureMethod = parsed.captureMethod;
      const scenario = parsed.scenario;
      const bodyHash = hashRequestBody([captureMethod, scenario ?? null, parsed.image?.mimeType ?? null, parsed.image?.bytes ?? null]);
      if (claim?.kind === "replay") {
        const first = await claim.wait();
        if (claim.entry.bodyHash && claim.entry.bodyHash !== bodyHash) {
          return c.json({ ok: false, error: "That Idempotency-Key was already used with a different request." }, 422);
        }
        const replayed = first ? getScan(userId, first) : undefined;
        if (replayed) {
          return c.json({ ok: true, scan: replayed, variantSuggestions: variantSuggestionsFor(replayed.mapping) }, 201);
        }
      }
      if (freshPersisted && claim?.kind === "new") {
        // After a restart the registry is empty; the deterministic scan ID still finds the first
        // scan, and its stored body hash (M2) still catches a different body.
        if (freshPersisted.idempotencyBodyHash && freshPersisted.idempotencyBodyHash !== bodyHash) {
          claim.finish(freshPersisted.idempotencyBodyHash, freshPersisted.scanId);
          return c.json({ ok: false, error: "That Idempotency-Key was already used with a different request." }, 422);
        }
        claim.finish(bodyHash, freshPersisted.scanId);
        return c.json({ ok: true, scan: freshPersisted, variantSuggestions: variantSuggestionsFor(freshPersisted.mapping) }, 201);
      }
      const scanId =
        scanIdempotencyKey && !persistedReplay
          ? scanIdForIdempotency(userId, scanIdempotencyKey)
          : crypto.randomUUID();
      claim?.kind === "new" && claim.setHash(bodyHash);
      try {
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
        const runLocal = () =>
          identifyLiveCaptureStill({
            image: identify.image,
            mimeType: identify.mimeType,
            fallback: recognitionProvider,
            openclip: liveIdentityOpenclip,
            catalog,
          });
        // Policy Reviewer (Oct 17): CardSight only for an account that attested 18+ AND has
        // current consent. Guests never (cap 0 too), whatever consent they send.
        // Sean: the photo goes to CardSight only with this user's current consent, checked here,
        // right before the adapter. Without it (or if CardSight misses) the local matcher runs.
        // Backend review M5: also only while this user's monthly CardSight cap has room. A use is
        // taken only when the adapter is actually called (not for cache hits).
        const monthKey = cardSightMonthKey(now());
        const userCap = isGuestUserId(userId) ? CARDSIGHT_GUEST_MONTHLY_CAP : cardSightUserCaps.signedIn;
        const cardSight =
          options.cardSight &&
          !isGuestUserId(userId) &&
          hasAgeConfirmation(store.ageConfirmations, userId) &&
          userCap > 0 &&
          cardSightConsented(userId) &&
          store.consents.monthlyUse(userId, monthKey) < userCap
            ? options.cardSight
            : null;
        // Charge per-user cap only after a successful CardSight response (errors/timeouts don't count).
        // Global budget is charged inside the adapter the same way (consumeBudget after ok:true).
        const runLive = cardSight
          ? async () => {
              if (store.consents.monthlyUse(userId, monthKey) >= userCap) return runLocal();
              const first = await cardSight.identifyCard(identifyRequest);
              if (first.ok) {
                store.consents.takeMonthlyUse(userId, monthKey, userCap);
                return first;
              }
              return runLocal();
            }
          : runLocal;
        recognition = recognitionCache
          ? await recognitionCache.getOrIdentify(
              { bytes: identify.image, mimeType: identify.mimeType },
              cardSight ? `cardsight+${recognitionProvider.name}` : recognitionProvider.name,
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
      const multi = await recognitionWithMultiCardMappings(recognition, catalog);
      recognition = multi.recognition;
      // P1-26: cards users keep confirming move up the candidate list (primary mapping + each card).
      const rerank = (mapped: typeof multi.mapping) =>
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
      const mapping = rerank(multi.mapping);
      const cardResults = multi.cardResults.map((row) => ({
        ...row,
        mapping: rerank(row.mapping),
      }));
      const scanHint = multi.scanHint;
      // Backend review M1: the account may have been deleted while recognition ran. Recheck the
      // session right before saving; if it's gone, drop the scan and its temp image.
      const bearer = parseBearerToken(c.req.header("authorization"));
      if (wasDeleted(userId) || (bearer && !getSessionByToken(bearer, now()))) {
        if (imageStorageRef) store.discardScanImage(scanId, imageStorageRef);
        if (claim?.kind === "new") claim.finish(bodyHash, undefined);
        return wasDeleted(userId) ? c.json(accountDeletedBody, 410) : c.json({ ok: false, error: "Unauthorized" }, 401);
      }
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
        idempotencyBodyHash: scanIdempotencyKey ? bodyHash : null,
        recognition,
        mapping,
        cardResults,
        scanHint,
      });
      if (claim?.kind === "new") claim.finish(bodyHash, scan.scanId);
      return c.json({ ok: true, scan, variantSuggestions: variantSuggestionsFor(scan.mapping) }, 201);
      } catch (error) {
        if (claim?.kind === "new") claim.finish(bodyHash, undefined);
        throw error;
      }
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
    const userId = c.get("userId");
    const scan = getScan(userId, c.req.param("scanId"));
    if (!scan) return c.json({ ok: false, error: "Scan not found" }, 404);
    const body = await c.req.json<{
      tcgdexId?: string;
      selectedVariant?: string | null;
      via?: string | null;
      detectionIndex?: number;
    }>();
    if (!body.tcgdexId) {
      return c.json({ ok: false, error: "tcgdexId is required" }, 400);
    }
    const detectionIndex = Math.max(0, Math.floor(body.detectionIndex ?? 0));
    const cardRow = scan.cardResults?.[detectionIndex];
    if (cardRow && !cardRow.countsTowardAllowance) {
      return c.json({ ok: false, error: cardRow.notice ?? SCAN_QUOTA_COPY.englishOnly }, 400);
    }
    // Sean: 30 free confirmed cards / month; Premium unlimited. Per confirmed card.
    const plan = resolveAccountPlan(userId, getGradeAccount(userId).plan);
    const since = monthStartIso(now());
    const usedThisMonth = listConfirmEvents({ since }).filter((e) => e.userId === userId).length;
    const quota = scanQuotaForUser({ plan, confirmEventsThisMonth: usedThisMonth, now: now() });
    if (!quota.unlimited && quota.remainingScans <= 0) {
      return c.json({
        ok: false,
        error: SCAN_QUOTA_COPY.outOfScans,
        code: "scan_quota_exceeded",
        quota,
      }, 403);
    }
    try {
      const mappingForConfirm = cardRow?.mapping ?? scan.mapping;
      const resolvedCatalog = await catalogCardForConfirm(
        catalog,
        body.tcgdexId,
        mappingForConfirm,
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
        detectionIndex,
      });
      const correction = scanCorrectionFor({
        scanId: scan.scanId,
        userId,
        via: body.via,
        predictedTcgdexId: mappingForConfirm.tcgdexId ?? mappingForConfirm.canonicalCard?.tcgdexId ?? null,
        candidateTcgdexIds: mappingForConfirm.candidates.map((card) => card.tcgdexId),
        chosenTcgdexId: body.tcgdexId,
        recognitionProvider: mappingForConfirm.provider,
      });
      if (correction) recordScanCorrection(correction);
      // Sean (Oct 19): scan photos are not kept. Delete the still once every card on it is done.
      deleteScanPhotoWhenSettled(userId, result.scan);
      const shown = mappingForConfirm.candidates.map((card) => card.tcgdexId);
      const predicted = mappingForConfirm.tcgdexId ?? mappingForConfirm.canonicalCard?.tcgdexId ?? null;
      saveConfirmEvent(
        confirmEventFor({
          scanId: scan.scanId,
          userId,
          via: body.via,
          shownTcgdexIds: shown.length > 0 ? shown : predicted ? [predicted] : [],
          chosenTcgdexId: body.tcgdexId,
          selectedVariant: body.selectedVariant ?? null,
          confidence: mappingForConfirm.confidence ?? null,
          recognitionProvider: mappingForConfirm.provider,
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
    store.deleteScanImage(c.get("userId"), scan.scanId);
    return c.json({ ok: true, scan: rejected });
  });

  /** Multi-card: skip one detection. Does not use the monthly scan allowance. */
  app.post("/v1/scans/:scanId/cards/:detectionIndex/skip", (c) => {
    const scan = getScan(c.get("userId"), c.req.param("scanId"));
    if (!scan) return c.json({ ok: false, error: "Scan not found" }, 404);
    const raw = Number(c.req.param("detectionIndex"));
    if (!Number.isFinite(raw) || raw < 0) {
      return c.json({ ok: false, error: "detectionIndex is required" }, 400);
    }
    const skipped = skipScanCard(scan, raw);
    if (!skipped) {
      return c.json({ ok: false, error: "That card can't be skipped" }, 409);
    }
    deleteScanPhotoWhenSettled(c.get("userId"), skipped);
    return c.json({ ok: true, scan: skipped });
  });

  app.get("/v1/cards/:cardflowCardId", (c) => {
    const card = getCanonical(c.req.param("cardflowCardId"));
    if (!card) return c.json({ ok: false, error: "Card not found" }, 404);
    return c.json({ ok: true, canonicalCard: card });
  });

  // MyDEX set view (Sean, Oct 19): catalog art only, owned = confirmed scan or purchased card.
  const DEX_CACHE_MS = 24 * 60 * 60 * 1000;
  const dexSetCardsCache = new Map<string, { at: number; cards: DexCatalogCard[] }>();
  const dexSetsCache: { at: number; sets: TcgdexSetBrief[] } = { at: 0, sets: [] };
  async function dexSets(): Promise<TcgdexSetBrief[]> {
    if (now().getTime() - dexSetsCache.at < DEX_CACHE_MS && dexSetsCache.sets.length > 0) return dexSetsCache.sets;
    const sets = (await catalog.listSets?.("en")) ?? [];
    dexSetsCache.at = now().getTime();
    dexSetsCache.sets = sets;
    return sets;
  }
  async function dexSetCards(setId: string): Promise<DexCatalogCard[]> {
    const hit = dexSetCardsCache.get(setId);
    if (hit && now().getTime() - hit.at < DEX_CACHE_MS) return hit.cards;
    const cards = (await catalog.listSetCards?.(setId, "en")) ?? [];
    dexSetCardsCache.set(setId, { at: now().getTime(), cards });
    if (dexSetCardsCache.size > 500) dexSetCardsCache.delete(dexSetCardsCache.keys().next().value as string);
    return cards;
  }
  /**
   * MyDEX ownership comes from exactly two sources:
   *  (a) a card confirmed through Scan a Card (single or multi-card photo scan), or
   *  (b) a Purchased tap in the livestream scanner HUD (purchased item tagged "livestream").
   * Watchlist entries, grading runs, manual Purchased saves and Watchlist→Purchased never count.
   * The livestream HUD creates a hidden "livestream_hud" scan; that scan is skipped
   * so undoing the HUD purchase also clears ownership.
   */
  function dexOwnedIds(userId: string): Set<string> {
    const owned = new Set<string>();
    for (const item of listInventory(userId)) {
      if (item.intent !== "purchased") continue;
      if (!(item.tags ?? []).includes(LIVESTREAM_SOURCE_TAG)) continue;
      const id = getCanonical(item.cardflowCardId)?.tcgdexId;
      if (id) owned.add(id);
    }
    for (const scan of listScans(userId)) {
      if (scan.captureMethod === "livestream_hud") continue;
      const ids = new Set<string>();
      if (scan.confirmationId) ids.add(scan.confirmationId);
      for (const row of scan.cardResults ?? []) if (row.confirmationId) ids.add(row.confirmationId);
      for (const id of ids) {
        const tcgdexId = getConfirmation(userId, id)?.tcgdexId;
        if (tcgdexId) owned.add(tcgdexId);
      }
    }
    return owned;
  }

  app.get("/v1/dex/sets", async (c) => {
    try {
      const counts = dexOwnedCountsBySet(dexOwnedIds(c.get("userId")));
      const sets: DexSetSummary[] = (await dexSets()).map((set) => ({
        setId: set.id,
        name: set.name,
        logo: set.logo ?? null,
        owned: counts.get(set.id) ?? 0,
        total: set.cardCount?.total ?? 0,
      }));
      return c.json({ ok: true, sets });
    } catch {
      return c.json({ ok: false, error: "Couldn't load sets. Try again." }, 502);
    }
  });

  app.get("/v1/dex/sets/:setId", async (c) => {
    const setId = c.req.param("setId");
    if (!/^[a-zA-Z0-9._-]{1,40}$/.test(setId)) return c.json({ ok: false, error: "Set not found" }, 404);
    try {
      const cards = await dexSetCards(setId);
      if (cards.length === 0) return c.json({ ok: false, error: "Set not found" }, 404);
      const brief = (await dexSets()).find((set) => set.id === setId);
      const view = buildDexSet({ setId, name: brief?.name ?? setId, logo: brief?.logo ?? null }, cards, dexOwnedIds(c.get("userId")));
      return c.json({ ok: true, set: view });
    } catch {
      return c.json({ ok: false, error: "Couldn't load this set. Try again." }, 502);
    }
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
    // Bought credits never expire; the period is only recorded as when they were last bought.
    addGradeCredits: (userId, credits, at) =>
      addGradeCredits(userId, credits, at, quotaPeriodForUser(userId, new Date(at)).period.key),
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
      const userId = c.get("userId") as string;
      const monthKey = cardSightMonthKey(now());
      const userCap = isGuestUserId(userId) ? CARDSIGHT_GUEST_MONTHLY_CAP : cardSightUserCaps.signedIn;
      // Sean (Oct 18): CardMagic for saved grade photos when enabled + consented; else local finder.
      const magic = await tryCardMagicForGrade({
        gate: {
          client: cardMagic,
          mayCall:
            Boolean(cardMagic) &&
            !isGuestUserId(userId) &&
            hasAgeConfirmation(store.ageConfirmations, userId) &&
            userCap > 0 &&
            cardSightConsented(userId),
          // Sean (Oct 18): save most of the free-plan CardSight cap for ID; CardMagic uses the remainder.
          mayUseIdReserve: () => {
            if (cardSightMonthlyBudget == null) return true;
            const used = store.getVendorQuotaUsage("cardsight", monthKey);
            return canCardMagicUseBudget(used, cardSightMonthlyBudget, cardMagicIdReserve);
          },
          // Peek before the call; charge only after a successful CardMagic response.
          budgetRemaining: () =>
            cardSightMonthlyBudget == null ||
            store.getVendorQuotaUsage("cardsight", monthKey) < cardSightMonthlyBudget,
          userCapRemaining: () => store.consents.monthlyUse(userId, monthKey) < userCap,
          consumeBudget: () =>
            consumeCardSightBudget({
              consume: store.consumeVendorQuota,
              getUsage: store.getVendorQuotaUsage,
              cap: cardSightMonthlyBudget,
              now: now(),
              onUsage: (used, cap) => metrics.recordCardSightBudgetUsage(used, cap),
            }),
          takeUse: () => store.consents.takeMonthlyUse(userId, monthKey, userCap),
        },
        still: parsed.still,
        side: parsed.side,
      });
      let cropPath: GradeCropPath = "local";
      let stillForStage = parsed.still;
      let result;
      if (magic.path === "cardmagic") {
        cropPath = "cardmagic";
        stillForStage = magic.still;
        result = magic.crop;
        // Full-grade session: store CardMagic corner close-ups as advisory extras when asked.
        if (parsed.sessionId) {
          for (const extra of cardMagicCornersToExtraShots(magic.corners)) {
            saveGradeExtraShot({
              userId,
              sessionId: parsed.sessionId,
              side: parsed.side,
              shot: extra.shot,
              still: { bytes: stripImageMetadata(extra.bytes, "image/jpeg"), mimeType: "image/jpeg" },
            });
          }
        }
      } else {
        result = await detectCardForGrade({
          runner: cardgrading,
          still: parsed.still,
          side: parsed.side,
          captureMeta: parsed.captureMeta ?? null,
        });
      }
      console.info(`grade-detect-path side=${parsed.side} path=${cropPath} found=${result.ok}`);
      // Retake and unavailable are answers, not transport errors: 200 with ok:false.
      if (!result.ok) return c.json({ ...result, cropPath });
      const uploadId = gradeUploads.stage(userId, parsed.side, stillForStage);
      return c.json({ ...result, uploadId, cropPath });
    },
  );

  // Full 14-photo grade (Sean, Oct 18): needs CARD_FLOW_GRADE_FULL_MODE=on and a full grade left
  // this period. Uploading doesn't spend one; /v1/grade/pregrade with fullGrade=true does.
  app.post(
    "/v1/grade/extra",
    detectRateLimit,
    bodyLimit({
      maxSize: GRADE_ROUTE_BODY_MAX_BYTES,
      onError: gradeBodyTooLarge,
    }),
    async (c) => {
      const userId = c.get("userId") as string;
      if (!gradeFullModeEnabled(gradeFullModeFlag())) {
        return c.json({ ok: false, error: "Full grade isn't turned on" }, 404);
      }
      const quota = quotaSnapshotFor(userId);
      if (quotaEnabled && (quota.fullGrade?.remaining ?? 0) <= 0) return outOfFullGradesResponse(c, quota);
      const parsed = await parseGradeExtraRequest(c);
      if ("error" in parsed) {
        return c.json({ ok: false, error: parsed.error }, parsed.status);
      }
      const blur = await checkExtraBlur(parsed.still);
      if (!blur.ok) {
        console.log(
          `grade-extra side=${parsed.side} shot=${parsed.shot} blur=fail sharpness=${blur.sharpness ?? "-"}`,
        );
        return c.json({
          ok: false as const,
          status: "retake" as const,
          code: "PHOTO_RETAKE" as const,
          side: parsed.side,
          shot: parsed.shot,
          reasons: [blur.reason ?? "Too blurry. Move back a little and retake."],
        });
      }
      const stored = saveGradeExtraShot({
        userId,
        sessionId: parsed.sessionId,
        side: parsed.side,
        shot: parsed.shot,
        still: parsed.still,
      });
      console.log(
        `grade-extra side=${parsed.side} shot=${parsed.shot} session=${parsed.sessionId} bytes=${parsed.still.bytes.byteLength} stored=${stored} sharpness=${blur.sharpness ?? "-"}`,
      );
      return c.json({
        ok: true as const,
        side: parsed.side,
        shot: parsed.shot,
        sessionId: parsed.sessionId,
        used: false,
        stored,
      });
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
      if (parsed.fullGrade && !gradeFullModeEnabled(gradeFullModeFlag())) {
        return c.json({ ok: false, error: "Full grade isn't turned on" }, 400);
      }
      // A full grade spends the full allowance only; a quick one spends the quick allowance.
      const taken = parsed.fullGrade ? takeFullGradeAllowance(c.get("userId")) : takeGradeAllowance(c.get("userId"));
      if (!taken.ok) {
        return parsed.fullGrade ? outOfFullGradesResponse(c, taken.quota) : outOfGradesResponse(c, taken.quota);
      }
      const userId = c.get("userId") as string;
      const extrasDir =
        parsed.fullGrade && parsed.sessionId
          ? gradeExtrasSessionPath(userId, parsed.sessionId)
          : null;
      const result = await pregradePhotoPair({
        runner: cardgrading,
        front: parsed.frontImage,
        back: parsed.backImage,
        angledFront: parsed.angledFront ?? [],
        extrasDir: extrasDir ?? undefined,
        captureMeta: parsed.captureMeta ?? null,
      });
      if (parsed.frontUploadId) gradeUploads.release(userId, parsed.frontUploadId);
      if (parsed.backUploadId) gradeUploads.release(userId, parsed.backUploadId);
      // Sean (Oct 19): photos are not kept. The angled extras go once the result is back.
      if (extrasDir && parsed.sessionId) deleteGradeExtrasSession(userId, parsed.sessionId);
      return c.json({ ...result, quota: taken.quota });
    },
  );

  // Mobile Tech Lead review: batch is enforced on the server, not only by the pre-check route.
  const batchGate = async (c: Context, next: () => Promise<void>) => {
    if (c.req.method !== "POST" || c.req.header(BATCH_GRADE_HEADER) !== "1") return next();
    const userId = c.get("userId") as string;
    if (resolveAccountPlan(userId, getGradeAccount(userId).plan) === "premium") return next();
    return c.json(premiumRequiredBody("batch_grading"), 403);
  };
  app.use("/v1/inventory/:inventoryItemId/grade-jobs", batchGate);
  app.use("/v1/inventory/:inventoryItemId/grade-estimate", batchGate);

  gradeJobRoutes = registerGradeJobRoutes(app, {
    enabled: options.gradeJobs ?? process.env.CARD_FLOW_GRADE_JOBS?.trim().toLowerCase() === "on",
    dispatch: (request, owner) => {
      internalJobRequests.set(request, owner);
      return Promise.resolve(app.fetch(request));
    },
    bodyLimit: bodyLimit({ maxSize: GRADE_ROUTE_BODY_MAX_BYTES, onError: gradeBodyTooLarge }),
    ...options.gradeJobLimits,
  });

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
      // Sean (Oct 19): grade photos are not kept. Once a real result is saved, delete the stored
      // front/back stills; only the numbers and text stay. A failed run keeps them for a retry,
      // and the hourly sweep removes anything left after 24 h.
      const gradeSaved = estimate.overall != null && estimate.overall >= 1;
      if (gradeSaved) {
        store.deleteGradeImage(userId, item.inventoryItemId, "front");
        store.deleteGradeImage(userId, item.inventoryItemId, "back");
      }
      // Cache only a real 1.0–10.0 number. Retake / unavailable / 0 must re-run.
      if (photoHash && gradeSaved) {
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
