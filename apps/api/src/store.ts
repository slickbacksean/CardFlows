import type { ConfirmEvent } from "@cardflow/shared";
import type { UserPriceSnapshot } from "@cardflow/shared";
import type { NorthStarWeekTotal } from "@cardflow/shared";
import { createMemorySalesStore, type SalesStore } from "./sales-store";
import { createMemoryPurchaseLedger, type PurchaseLedger } from "./purchase-ledger";
import { createMemoryAgeConfirmationStore, type AgeConfirmationStore } from "./age-store";
import { createMemoryConsentStore, type ConsentStore } from "./consent-store";
import { createMemoryIdempotencyStore, type IdempotencyStore } from "./idempotency-store";
import { createMemoryGradeHistoryStore, type GradeHistoryStore } from "./grade-history-store";
import {
  EMAIL_CODE_MAX_ATTEMPTS,
  emailSendKey,
  normalizeEmail,
  resolveNorthStarTotals,
  type AccountRecord,
  type AccountStore,
  type DeletionAuditEntry,
  type PokecollectorDeletionMode,
  type PokecollectorPendingDeletion,
} from "./account-store";
import {
  catalogFingerprint,
  cachedCatalogCardMatches,
  confirmIdentity,
  createUserPreferencesStore,
  crmRowsForUser,
  crmValueForUser,
  listInvitedIdentities,
  recomputeCopyMaxBuy,
  requireInvitedIdentity,
  type CachedCatalogQuery,
  type CaptureMethod,
  type CardFlowCanonicalCard,
  type CardFlowNormalizedRecognitionResult,
  type CatalogMappingResult,
  GRADE_SIDES,
  type GradeSide,
  type GradingReturnedCopy,
  type GradingSubmittedCopy,
  type InventoryIntent,
  type InvitedIdentity,
  type ListingDraft,
  type MaxBuyComputation,
  type MaxBuyPreferences,
  type RecognitionScenario,
  decideGradeConsume,
  isGradePlan,
  type GradePlan,
  type GradeQuotaConsumeSource,
} from "@cardflow/shared";
import {
  gradeImageStorageCandidates,
  gradeImageStorageRef,
  isFirstPartyGradeImageRef,
  mimeFromGradeStorageRef,
  stripImageMetadata,
  type GradeImageBytes,
} from "./grade-image";
import {
  isGradePhotoExpired,
  type GradePhotoObject,
  type PhotoPurgeResult,
} from "./photo-retention";
import {
  isFirstPartyScanImageRef,
  mimeFromScanStorageRef,
  scanImageStorageRef,
  type ScanImageBytes,
  type ScanImageMimeType,
} from "./scan-image";
import type { PokecollectorUserMapping } from "./pokecollector-accounts";
import {
  hashSessionToken,
  isSessionExpired,
  mintSessionToken,
  sessionExpiryIso,
  type CreatedSession,
  type SessionRecord,
} from "./session";

export type { ScanImageBytes, ScanImageMimeType, GradeImageBytes };
export type { CreatedSession, SessionRecord };

export interface ScanRecord {
  scanId: string;
  userId: string;
  capturedAt: string;
  captureMethod: CaptureMethod;
  scenario: RecognitionScenario;
  preInventoryState: "scan_captured" | "identity_confirmed" | "identity_rejected";
  cardflowCardId: string | null;
  confirmationId: string | null;
  inventoryItemId: string | null;
  imageStorageRef: string | null;
  imageMimeType: ScanImageMimeType | null;
  /** Backend review M2: body hash of the Idempotency-Key request that made this scan. */
  idempotencyBodyHash?: string | null;
  recognition: CardFlowNormalizedRecognitionResult;
  mapping: CatalogMappingResult;
}

export interface ConfirmationRecord {
  confirmationId: string;
  scanId: string;
  cardflowCardId: string;
  tcgdexId: string;
  language: string;
  selectedVariant: string | null;
  matchMethod: string;
  confirmedAt: string;
  mintedCardflowCardId: boolean;
}

export interface InventoryItemRecord {
  inventoryItemId: string;
  userId: string;
  cardflowCardId: string;
  confirmationId: string;
  scanId: string;
  intent: InventoryIntent;
  grain: "physical_copy" | "interest_not_physical_copy";
  selectedVariant: string | null;
  condition: string | null;
  quantity: number | null;
  tags: string[];
  workflowState: "acquired" | "watching" | "drafted" | "details_needed" | "watchlist_closed";
  referencePriceAmount: string | null;
  targetMaxBuyAmount: string | null;
  closedAt?: string | null;
  createdAt: string;
  purchase: {
    purchaseId: string;
    purchasedAt: string;
    currency: string;
    costBasis: {
      purchasePrice: string | null;
      shipping: string;
      tax: string;
      fees: string;
      supplies: string;
      allInTotal: string | null;
    };
    maxBuy: MaxBuyComputation;
  } | null;
}

export interface GradeAccountRecord {
  plan: GradePlan;
  /** Bought credits. They never expire and are spent after the monthly allowance. */
  extraCredits: number;
  anchorAt?: string | null;
  billingAnchorAt?: string | null;
  creditsPeriod?: string | null;
}

export interface GradeQuotaConsumeInput {
  /** The allowance period key (period start date). */
  monthKey: string;
  monthlyLimit: number;
  at: string;
  /** Full 14-photo grades: monthly allowance only, bought credits are not spent. */
  noCredits?: boolean;
}

export type GradeQuotaConsumeResult =
  | {
      ok: true;
      source: GradeQuotaConsumeSource;
      usedThisMonth: number;
      extraCredits: number;
    }
  | { ok: false; usedThisMonth: number; extraCredits: number };

/** One recorded collection estimate for a local day. Recorded going forward, never backfilled. */
export interface PortfolioValueSnapshot {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  amountCents: number;
  currency: "USD";
  pricedCopies: number;
  totalCopies: number;
  recordedAt: string;
}

interface StoredSession extends SessionRecord {
  tokenHash: string;
  isGuest?: boolean;
}

interface Store {
  sessions: Map<string, StoredSession>;
  scans: Map<string, ScanRecord>;
  scanImages: Map<string, ScanImageBytes>;
  gradeImages: Map<string, GradeImageBytes>;
  gradePhotoMeta: Map<string, GradePhotoObject>;
  confirmations: Map<string, ConfirmationRecord>;
  canonicalByFingerprint: Map<string, CardFlowCanonicalCard>;
  inventory: InventoryItemRecord[];
  drafts: Map<string, ListingDraft>;
  draftIdByInventoryItemId: Map<string, string>;
  pokecollectorUsers: Map<string, PokecollectorUserMapping>;
  gradingSubmitted: GradingSubmittedCopy[];
  gradingReturned: GradingReturnedCopy[];
  gradeEstimateCache: Map<string, { photoHash: string; estimateJson: string }>;
  portfolioSnapshots: Map<string, Map<string, PortfolioValueSnapshot>>;
}

const store: Store = {
  sessions: new Map(),
  scans: new Map(),
  scanImages: new Map(),
  gradeImages: new Map(),
  gradePhotoMeta: new Map(),
  confirmations: new Map(),
  canonicalByFingerprint: new Map(),
  inventory: [],
  drafts: new Map(),
  draftIdByInventoryItemId: new Map(),
  pokecollectorUsers: new Map(),
  gradingSubmitted: [],
  gradingReturned: [],
  gradeEstimateCache: new Map(),
  portfolioSnapshots: new Map(),
};

const userPreferences = createUserPreferencesStore();

export function listInvitedUsers(): InvitedIdentity[] {
  return listInvitedIdentities();
}

export function createSession(userId: string): CreatedSession {
  const identity = requireInvitedIdentity(userId);
  const token = mintSessionToken();
  const createdAt = new Date();
  const session: StoredSession = {
    sessionId: crypto.randomUUID(),
    tokenHash: hashSessionToken(token),
    userId: identity.userId,
    createdAt: createdAt.toISOString(),
    expiresAt: sessionExpiryIso(createdAt),
  };
  store.sessions.set(session.tokenHash, session);
  return {
    token,
    identity,
    session: {
      sessionId: session.sessionId,
      userId: session.userId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    },
  };
}

export function getSessionByToken(token: string, now: Date = new Date()): SessionRecord | undefined {
  const hashed = hashSessionToken(token);
  const session = store.sessions.get(hashed);
  if (!session || isSessionExpired(session.expiresAt, now)) return undefined;
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    isGuest: session.isGuest === true,
  };
}

export function getPokecollectorUserMapping(userId: string): PokecollectorUserMapping | undefined {
  return store.pokecollectorUsers.get(userId);
}

export function listPokecollectorUserMappings(): PokecollectorUserMapping[] {
  return [...store.pokecollectorUsers.values()].map((mapping) => ({ ...mapping }));
}

export function deletePokecollectorUserMapping(userId: string): boolean {
  return store.pokecollectorUsers.delete(userId);
}

/** CardFlow users linked to this PokéCollector user (a remote user must never be shared). */
export function countPokecollectorLinks(pokecollectorUserId: string): number {
  let n = 0;
  for (const mapping of store.pokecollectorUsers.values()) if (mapping.pokecollectorUserId === pokecollectorUserId) n += 1;
  return n;
}

export function savePokecollectorUserMapping(
  mapping: PokecollectorUserMapping,
): PokecollectorUserMapping {
  store.pokecollectorUsers.set(mapping.userId, mapping);
  return mapping;
}

export function getPreferences(userId: string): MaxBuyPreferences {
  return userPreferences.get(userId);
}

export function setPreferences(userId: string, next: MaxBuyPreferences): MaxBuyPreferences {
  return userPreferences.set(userId, next);
}

/** Overlay live Max Buy. Does not rewrite stored reference or all-in. */
export function inventoryItemWithLiveGuidance(
  item: InventoryItemRecord,
  preferences: MaxBuyPreferences = getPreferences(item.userId),
): InventoryItemRecord {
  const maxBuy = recomputeCopyMaxBuy(
    {
      referencePriceAmount: item.referencePriceAmount,
      condition: item.condition,
    },
    preferences,
  );
  return {
    ...item,
    targetMaxBuyAmount:
      item.intent === "watchlist" ? maxBuy.maxBuyAmount : item.targetMaxBuyAmount,
    purchase: item.purchase ? { ...item.purchase, maxBuy } : null,
  };
}

export function getScan(userId: string, scanId: string): ScanRecord | undefined {
  const scan = store.scans.get(scanId);
  if (!scan || scan.userId !== userId) return undefined;
  return scan;
}

export function listScans(userId: string): ScanRecord[] {
  return crmRowsForUser([...store.scans.values()], userId);
}

export function saveScan(scan: ScanRecord): ScanRecord {
  store.scans.set(scan.scanId, scan);
  return scan;
}

/** Backend review L1 (P4): when each in-memory image was saved (the orphan sweep's age cutoff). */
const scanImageSavedAt = new WeakMap<ScanImageBytes, number>();

export function saveScanImage(
  scanId: string,
  input: { bytes: Uint8Array; mimeType: ScanImageMimeType },
): ScanImageBytes {
  const record: ScanImageBytes = {
    storageRef: scanImageStorageRef(scanId, input.mimeType),
    mimeType: input.mimeType,
    bytes: stripImageMetadata(input.bytes, input.mimeType),
  };
  store.scanImages.set(scanId, record);
  scanImageSavedAt.set(record, Date.now());
  return record;
}

function gradePhotoMetaKey(userId: string, inventoryItemId: string, side: GradeSide): string {
  return `${userId}\0${inventoryItemId}\0${side}`;
}

export function deleteScanImage(userId: string, scanId: string): boolean {
  const scan = getScan(userId, scanId);
  if (!scan) return false;
  const had = store.scanImages.delete(scanId);
  if (scan.imageStorageRef || scan.imageMimeType) {
    store.scans.set(scanId, { ...scan, imageStorageRef: null, imageMimeType: null });
    return true;
  }
  return had;
}

/** Re-read persisted still bytes by first-party `image_storage_ref`. */
export function readStoredScanImage(
  scanId: string,
  storageRef: string,
): ScanImageBytes | undefined {
  if (!isFirstPartyScanImageRef(storageRef)) return undefined;
  const mimeType = mimeFromScanStorageRef(storageRef);
  if (!mimeType) return undefined;
  if (scanImageStorageRef(scanId, mimeType) !== storageRef) return undefined;
  const record = store.scanImages.get(scanId);
  if (!record || record.storageRef !== storageRef) return undefined;
  return record;
}

export function getScanImage(userId: string, scanId: string): ScanImageBytes | undefined {
  const scan = getScan(userId, scanId);
  if (!scan?.imageStorageRef || !scan.imageMimeType) return undefined;
  return readStoredScanImage(scanId, scan.imageStorageRef);
}

export function saveGradeImage(
  userId: string,
  inventoryItemId: string,
  side: GradeSide,
  input: { bytes: Uint8Array; mimeType: ScanImageMimeType; createdAt?: string },
): GradeImageBytes | undefined {
  if (!getInventoryItem(userId, inventoryItemId)) return undefined;
  const createdAt = input.createdAt ?? new Date().toISOString();
  const record: GradeImageBytes = {
    storageRef: gradeImageStorageRef(inventoryItemId, side, input.mimeType),
    mimeType: input.mimeType,
    bytes: stripImageMetadata(input.bytes, input.mimeType),
    createdAt,
  };
  for (const candidate of gradeImageStorageCandidates(inventoryItemId, side)) {
    store.gradeImages.delete(candidate);
  }
  store.gradeImages.set(record.storageRef, record);
  store.gradePhotoMeta.set(gradePhotoMetaKey(userId, inventoryItemId, side), {
    userId,
    inventoryItemId,
    side,
    storageRef: record.storageRef,
    createdAt,
  });
  return record;
}

export function getGradeImage(
  userId: string,
  inventoryItemId: string,
  side: GradeSide,
): GradeImageBytes | undefined {
  if (!getInventoryItem(userId, inventoryItemId)) return undefined;
  for (const candidate of gradeImageStorageCandidates(inventoryItemId, side)) {
    if (!isFirstPartyGradeImageRef(candidate)) continue;
    const mimeType = mimeFromGradeStorageRef(candidate);
    if (!mimeType) continue;
    const record = store.gradeImages.get(candidate);
    if (record && record.storageRef === candidate) {
      const meta = store.gradePhotoMeta.get(gradePhotoMetaKey(userId, inventoryItemId, side));
      return meta ? { ...record, createdAt: meta.createdAt } : record;
    }
  }
  return undefined;
}

export function deleteGradeImage(
  userId: string,
  inventoryItemId: string,
  side: GradeSide,
): boolean {
  if (!getInventoryItem(userId, inventoryItemId)) return false;
  let deleted = false;
  for (const candidate of gradeImageStorageCandidates(inventoryItemId, side)) {
    if (store.gradeImages.delete(candidate)) deleted = true;
  }
  if (store.gradePhotoMeta.delete(gradePhotoMetaKey(userId, inventoryItemId, side))) {
    deleted = true;
  }
  store.gradeEstimateCache.delete(gradeEstimateCacheKey(userId, inventoryItemId));
  return deleted;
}

export function deleteUserPhotos(userId: string): PhotoPurgeResult {
  let deleted = 0;
  for (const item of listInventory(userId)) {
    for (const side of GRADE_SIDES) {
      if (deleteGradeImage(userId, item.inventoryItemId, side)) deleted += 1;
    }
  }
  for (const scan of listScans(userId)) {
    if (deleteScanImage(userId, scan.scanId)) deleted += 1;
  }
  return { deleted };
}

/** D9: user IDs that have scans and start with `prefix` (guest cleanup). */
export function listScanUserIds(prefix: string): string[] {
  return [...new Set([...store.scans.values()].map((scan) => scan.userId).filter((id) => id.startsWith(prefix)))];
}

/** D9: guest cleanup. Photos, then the scan rows. Returns scans removed. */
export function deleteUserScans(userId: string): number {
  deleteUserPhotos(userId);
  const scans = listScans(userId);
  for (const scan of scans) {
    store.scanImages.delete(scan.scanId);
    store.scans.delete(scan.scanId);
  }
  return scans.length;
}

export function purgeExpiredGradePhotos(now: Date = new Date()): PhotoPurgeResult {
  let deleted = 0;
  for (const meta of [...store.gradePhotoMeta.values()]) {
    if (!isGradePhotoExpired(meta.createdAt, now)) continue;
    if (deleteGradeImage(meta.userId, meta.inventoryItemId, meta.side)) deleted += 1;
  }
  return { deleted };
}

export function listInventory(userId: string): InventoryItemRecord[] {
  return [...store.inventory]
    .filter((item) => item.userId === userId)
    .reverse();
}

export function confirmScan(input: {
  scan: ScanRecord;
  selectedTcgdexId: string;
  selectedVariant?: string | null;
  catalogCard?: CardFlowCanonicalCard | null;
}): { scan: ScanRecord; confirmation: ConfirmationRecord; canonicalCard: CardFlowCanonicalCard } {
  const fingerprint = catalogFingerprint("en", input.selectedTcgdexId);
  const existing = store.canonicalByFingerprint.get(fingerprint);
  const catalogCard =
    input.catalogCard !== undefined ? input.catalogCard ?? existing ?? null : undefined;
  const confirmed = confirmIdentity({
    mapping: input.scan.mapping,
    selectedTcgdexId: input.selectedTcgdexId,
    selectedVariant: input.selectedVariant,
    existingCardflowCardId: existing?.cardflowCardId ?? null,
    catalogCard,
  });

  store.canonicalByFingerprint.set(fingerprint, confirmed.canonicalCard);

  const confirmation: ConfirmationRecord = {
    confirmationId: crypto.randomUUID(),
    scanId: input.scan.scanId,
    cardflowCardId: confirmed.canonicalCard.cardflowCardId as string,
    tcgdexId: input.selectedTcgdexId,
    language: "en",
    selectedVariant: input.selectedVariant ?? null,
    matchMethod: confirmed.matchMethod,
    confirmedAt: new Date().toISOString(),
    mintedCardflowCardId: confirmed.mintedCardflowCardId,
  };

  const scan: ScanRecord = {
    ...input.scan,
    preInventoryState: "identity_confirmed",
    cardflowCardId: confirmation.cardflowCardId,
    confirmationId: confirmation.confirmationId,
  };

  store.confirmations.set(confirmation.confirmationId, confirmation);
  store.scans.set(scan.scanId, scan);

  return { scan, confirmation, canonicalCard: confirmed.canonicalCard };
}

/** Sets the scan aside. Does not mint a card or an inventory row. */
export function rejectScan(scan: ScanRecord): ScanRecord | null {
  if (scan.preInventoryState === "identity_confirmed") return null;
  if (scan.preInventoryState === "identity_rejected") return scan;
  const next: ScanRecord = {
    ...scan,
    preInventoryState: "identity_rejected",
    cardflowCardId: null,
    confirmationId: null,
  };
  store.scans.set(scan.scanId, next);
  return next;
}

export function getConfirmation(
  userId: string,
  confirmationId: string,
): ConfirmationRecord | undefined {
  const confirmation = store.confirmations.get(confirmationId);
  if (!confirmation) return undefined;
  return getScan(userId, confirmation.scanId) ? confirmation : undefined;
}

export function getCanonical(cardflowCardId: string): CardFlowCanonicalCard | undefined {
  return [...store.canonicalByFingerprint.values()].find(
    (card) => card.cardflowCardId === cardflowCardId,
  );
}

export function findCachedCanonicals(query: CachedCatalogQuery): CardFlowCanonicalCard[] {
  return [...store.canonicalByFingerprint.values()].filter((card) =>
    cachedCatalogCardMatches(card, query),
  );
}

export function getInventoryItem(
  userId: string,
  inventoryItemId: string,
): InventoryItemRecord | undefined {
  return store.inventory.find(
    (item) => item.inventoryItemId === inventoryItemId && item.userId === userId,
  );
}

export function updateInventoryItem(
  userId: string,
  inventoryItemId: string,
  patch: Partial<InventoryItemRecord>,
): InventoryItemRecord | undefined {
  const index = store.inventory.findIndex((item) => item.inventoryItemId === inventoryItemId);
  const current = store.inventory[index];
  if (index < 0 || !current || current.userId !== userId) return undefined;
  const next = { ...current, ...patch };
  store.inventory[index] = next;
  return next;
}

export function getDraft(userId: string, draftId: string): ListingDraft | undefined {
  return crmValueForUser(store.drafts.get(draftId), userId) ?? undefined;
}

export function listDrafts(userId: string): ListingDraft[] {
  return crmRowsForUser([...store.drafts.values()], userId);
}

export function getDraftForInventoryItem(
  userId: string,
  inventoryItemId: string,
): ListingDraft | undefined {
  if (!getInventoryItem(userId, inventoryItemId)) return undefined;
  const draftId = store.draftIdByInventoryItemId.get(inventoryItemId);
  return draftId ? getDraft(userId, draftId) : undefined;
}

export function saveDraft(draft: ListingDraft): ListingDraft {
  store.drafts.set(draft.draftId, draft);
  store.draftIdByInventoryItemId.set(draft.inventoryItemId, draft.draftId);
  return draft;
}

export function saveInventoryItem(item: InventoryItemRecord): InventoryItemRecord {
  store.inventory.push(item);
  const scan = store.scans.get(item.scanId);
  if (scan) {
    store.scans.set(item.scanId, { ...scan, inventoryItemId: item.inventoryItemId });
  }
  return item;
}

/** Reverses a Purchased write. Leaves no inventory, purchase, or draft row behind. */
export function deleteInventoryItem(userId: string, inventoryItemId: string): boolean {
  const item = getInventoryItem(userId, inventoryItemId);
  if (!item) return false;
  store.inventory = store.inventory.filter((row) => row.inventoryItemId !== inventoryItemId);
  const draftId = store.draftIdByInventoryItemId.get(inventoryItemId);
  if (draftId) {
    store.drafts.delete(draftId);
    store.draftIdByInventoryItemId.delete(inventoryItemId);
  }
  store.gradingSubmitted = store.gradingSubmitted.filter(
    (row) => !(row.userId === userId && row.inventoryItemId === inventoryItemId),
  );
  store.gradingReturned = store.gradingReturned.filter(
    (row) => !(row.userId === userId && row.inventoryItemId === inventoryItemId),
  );
  store.gradeEstimateCache.delete(gradeEstimateCacheKey(userId, inventoryItemId));
  for (const side of GRADE_SIDES) {
    for (const candidate of gradeImageStorageCandidates(inventoryItemId, side)) {
      store.gradeImages.delete(candidate);
    }
  }
  const scan = store.scans.get(item.scanId);
  if (scan?.inventoryItemId === inventoryItemId) {
    store.scans.set(item.scanId, { ...scan, inventoryItemId: null });
  }
  return true;
}

export function listGradingSubmitted(userId: string): GradingSubmittedCopy[] {
  return crmRowsForUser(store.gradingSubmitted, userId);
}

export function listGradingReturned(userId: string): GradingReturnedCopy[] {
  return crmRowsForUser(store.gradingReturned, userId);
}

export function saveGradingSubmitted(copy: GradingSubmittedCopy): GradingSubmittedCopy {
  store.gradingSubmitted = [
    ...store.gradingSubmitted.filter(
      (row) => !(row.userId === copy.userId && row.inventoryItemId === copy.inventoryItemId),
    ),
    copy,
  ];
  return copy;
}

export function saveGradingReturned(copy: GradingReturnedCopy): GradingReturnedCopy {
  store.gradingReturned = [
    ...store.gradingReturned.filter(
      (row) => !(row.userId === copy.userId && row.inventoryItemId === copy.inventoryItemId),
    ),
    copy,
  ];
  return copy;
}

export function deleteGradingSubmitted(userId: string, inventoryItemId: string): void {
  store.gradingSubmitted = store.gradingSubmitted.filter(
    (row) => !(row.userId === userId && row.inventoryItemId === inventoryItemId),
  );
}

function gradeEstimateCacheKey(userId: string, inventoryItemId: string): string {
  return `${userId}\0${inventoryItemId}`;
}

export function getGradeEstimateCache(
  userId: string,
  inventoryItemId: string,
): { photoHash: string; estimateJson: string } | undefined {
  return store.gradeEstimateCache.get(gradeEstimateCacheKey(userId, inventoryItemId));
}

export function saveGradeEstimateCache(
  userId: string,
  inventoryItemId: string,
  record: { photoHash: string; estimateJson: string },
): void {
  store.gradeEstimateCache.set(gradeEstimateCacheKey(userId, inventoryItemId), record);
}

/** Upsert by `(userId, date)`: the latest estimate of the day wins. */
export function savePortfolioSnapshot(
  userId: string,
  snapshot: PortfolioValueSnapshot,
): PortfolioValueSnapshot {
  const byDate = store.portfolioSnapshots.get(userId) ?? new Map<string, PortfolioValueSnapshot>();
  byDate.set(snapshot.date, { ...snapshot });
  store.portfolioSnapshots.set(userId, byDate);
  return snapshot;
}

/** Oldest first. `sinceDate` is an inclusive `YYYY-MM-DD` lower bound. */
export function listPortfolioSnapshots(
  userId: string,
  sinceDate?: string | null,
): PortfolioValueSnapshot[] {
  const byDate = store.portfolioSnapshots.get(userId);
  if (!byDate) return [];
  return [...byDate.values()]
    .filter((row) => !sinceDate || row.date >= sinceDate)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((row) => ({ ...row }));
}

export function moveGradingSubmittedToReturned(copy: GradingReturnedCopy): void {
  store.gradingSubmitted = store.gradingSubmitted.filter(
    (row) => !(row.userId === copy.userId && row.inventoryItemId === copy.inventoryItemId),
  );
  store.gradingReturned = [
    ...store.gradingReturned.filter(
      (row) => !(row.userId === copy.userId && row.inventoryItemId === copy.inventoryItemId),
    ),
    copy,
  ];
}

/** Route-facing CRM port. CRM reads/writes take request-scoped userId. */
export interface StorePort {
  /** Open sign-up accounts, guest sessions, whole-user move/delete. */
  accounts: AccountStore;
  /** P2-03 sale records. */
  sales: SalesStore;
  /** Data Engineer review: purchases are voided, never forgotten (North Star excludes voided). */
  purchaseLedger: PurchaseLedger;
  /** Backend review M3: persisted queued-write idempotency (24 h). */
  idempotency: IdempotencyStore;
  /** Sean: CardSight consent (version + timestamps). */
  consents: ConsentStore;
  /** Sean (Oct 17): accounts' 18+ attestation (time + wording version; never a birth date). */
  ageConfirmations: AgeConfirmationStore;
  /** P2-07 pre-grade estimate history. */
  gradeHistory: GradeHistoryStore;
  createSession: typeof createSession;
  getSessionByToken: typeof getSessionByToken;
  getPokecollectorUserMapping: typeof getPokecollectorUserMapping;
  savePokecollectorUserMapping: typeof savePokecollectorUserMapping;
  listPokecollectorUserMappings: typeof listPokecollectorUserMappings;
  deletePokecollectorUserMapping: typeof deletePokecollectorUserMapping;
  countPokecollectorLinks: typeof countPokecollectorLinks;
  listInvitedUsers: typeof listInvitedUsers;
  getPreferences: typeof getPreferences;
  setPreferences: typeof setPreferences;
  inventoryItemWithLiveGuidance: typeof inventoryItemWithLiveGuidance;
  getScan: typeof getScan;
  listScans: typeof listScans;
  saveScan: typeof saveScan;
  saveScanImage: typeof saveScanImage;
  readStoredScanImage: typeof readStoredScanImage;
  getScanImage: typeof getScanImage;
  deleteScanImage: typeof deleteScanImage;
  /** Backend review M1: drops a temp image whose scan was never saved (account deleted mid-scan). */
  discardScanImage: (scanId: string, storageRef: string) => boolean;
  /** Backend review M1: scan image files with no crm_scans row, older than `olderThan`. Returns files removed. */
  sweepOrphanScanImages: (olderThan: Date) => number;
  saveGradeImage: typeof saveGradeImage;
  getGradeImage: typeof getGradeImage;
  deleteGradeImage: typeof deleteGradeImage;
  deleteUserPhotos: typeof deleteUserPhotos;
  /** Collects photo locations now; the returned function deletes the files (after the rows). */
  prepareUserPhotoDeletion: (userId: string) => () => PhotoPurgeResult;
  deleteUserScans: typeof deleteUserScans;
  listScanUserIds: typeof listScanUserIds;
  purgeExpiredGradePhotos: typeof purgeExpiredGradePhotos;
  listInventory: typeof listInventory;
  confirmScan: typeof confirmScan;
  rejectScan: typeof rejectScan;
  getConfirmation: typeof getConfirmation;
  getCanonical: typeof getCanonical;
  findCachedCanonicals: typeof findCachedCanonicals;
  getInventoryItem: typeof getInventoryItem;
  updateInventoryItem: typeof updateInventoryItem;
  getDraft: typeof getDraft;
  listDrafts: typeof listDrafts;
  getDraftForInventoryItem: typeof getDraftForInventoryItem;
  saveDraft: typeof saveDraft;
  saveInventoryItem: typeof saveInventoryItem;
  deleteInventoryItem: typeof deleteInventoryItem;
  listGradingSubmitted: typeof listGradingSubmitted;
  listGradingReturned: typeof listGradingReturned;
  saveGradingSubmitted: typeof saveGradingSubmitted;
  saveGradingReturned: typeof saveGradingReturned;
  deleteGradingSubmitted: typeof deleteGradingSubmitted;
  moveGradingSubmittedToReturned: typeof moveGradingSubmittedToReturned;
  getGradeEstimateCache: typeof getGradeEstimateCache;
  saveGradeEstimateCache: typeof saveGradeEstimateCache;
  savePortfolioSnapshot: typeof savePortfolioSnapshot;
  listPortfolioSnapshots: typeof listPortfolioSnapshots;
  getGradeAccount: (userId: string) => GradeAccountRecord;
  setGradePlan: (userId: string, plan: GradePlan, at: string) => GradeAccountRecord;
  /** Bought credits add up and never expire. `periodKey` only records the period of the last purchase. */
  addGradeCredits: (userId: string, credits: number, at: string, periodKey?: string) => GradeAccountRecord;
  /** Creates the grade account if needed and sets `anchorAt` once. */
  ensureGradeAnchor: (userId: string, at: string) => GradeAccountRecord;
  setBillingAnchor: (userId: string, billingAnchorAt: string | null, at: string) => GradeAccountRecord;
  getGradeQuotaUsage: (userId: string, monthKey: string) => number;
  consumeGradeQuota: (userId: string, input: GradeQuotaConsumeInput) => GradeQuotaConsumeResult;
  getVendorQuotaUsage: (provider: string, monthKey: string) => number;
  consumeVendorQuota: (provider: string, monthKey: string, cap: number) => boolean;
  /** P1-26 confirm log. */
  saveConfirmEvent: (event: ConfirmEvent) => void;
  listConfirmEvents: (options?: { since?: string; limit?: number }) => ConfirmEvent[];
  confirmCounts: (tcgdexIds: readonly string[]) => Map<string, number>;
  variantCounts: (tcgdexId: string) => Map<string, number>;
  deleteUserConfirmEvents: (userId: string) => number;
  /** P1-12 your own reference prices. */
  saveUserPriceSnapshot: (userId: string, snapshot: UserPriceSnapshot) => UserPriceSnapshot;
  listUserPriceSnapshots: (userId: string, tcgdexId: string, variant?: string | null) => UserPriceSnapshot[];
  deleteUserPriceSnapshots: (userId: string) => number;
}

const DEFAULT_GRADE_ACCOUNT: GradeAccountRecord = { plan: "free", extraCredits: 0 };

/** Plain in-memory confirm log, shared by the memory store and tests. */
export function createMemoryConfirmLog(cap = 50_000) {
  const events: ConfirmEvent[] = [];
  return {
    saveConfirmEvent(event: ConfirmEvent) {
      events.push({ ...event, shownTcgdexIds: [...event.shownTcgdexIds] });
      if (events.length > cap) events.shift();
    },
    listConfirmEvents(options: { since?: string; limit?: number } = {}) {
      const since = options.since;
      const rows = since ? events.filter((e) => e.at >= since) : [...events];
      return options.limit ? rows.slice(-options.limit) : rows;
    },
    confirmCounts(tcgdexIds: readonly string[]) {
      const want = new Set(tcgdexIds);
      const counts = new Map<string, number>();
      for (const e of events) if (want.has(e.chosenTcgdexId)) counts.set(e.chosenTcgdexId, (counts.get(e.chosenTcgdexId) ?? 0) + 1);
      return counts;
    },
    variantCounts(tcgdexId: string) {
      const counts = new Map<string, number>();
      for (const e of events) if (e.chosenTcgdexId === tcgdexId && e.selectedVariant) counts.set(e.selectedVariant, (counts.get(e.selectedVariant) ?? 0) + 1);
      return counts;
    },
    deleteUserConfirmEvents(userId: string) {
      let removed = 0;
      for (let i = events.length - 1; i >= 0; i -= 1) if (events[i]!.userId === userId) { events.splice(i, 1); removed += 1; }
      return removed;
    },
  };
}

/** Keep the last N of your prices per card; older ones add nothing to Max Buy. */
export const USER_PRICE_SNAPSHOTS_PER_CARD = 20;

export function filterUserPriceSnapshots(
  rows: readonly (UserPriceSnapshot & { userId: string })[],
  userId: string,
  tcgdexId: string,
  variant?: string | null,
): UserPriceSnapshot[] {
  return rows
    .filter((r) => r.userId === userId && r.tcgdexId === tcgdexId && (variant === undefined || (r.variant ?? null) === (variant ?? null)))
    .map(({ userId: _u, ...s }) => s)
    .sort((a, b) => b.enteredAt.localeCompare(a.enteredAt))
    .slice(0, USER_PRICE_SNAPSHOTS_PER_CARD);
}

export function createMemoryStore(): StorePort {
  const confirmLog = createMemoryConfirmLog();
  const userPrices: (UserPriceSnapshot & { userId: string })[] = [];
  const gradeAccounts = new Map<string, GradeAccountRecord>();
  const gradeUsage = new Map<string, number>();
  const vendorUsage = new Map<string, number>();

  function usageKey(userId: string, monthKey: string): string {
    return `${userId}\0${monthKey}`;
  }

  function vendorKey(provider: string, monthKey: string): string {
    return `${provider}\0${monthKey}`;
  }

  function getGradeAccount(userId: string): GradeAccountRecord {
    const row = gradeAccounts.get(userId);
    return row ? { ...row } : { ...DEFAULT_GRADE_ACCOUNT };
  }

  function setGradePlan(userId: string, plan: GradePlan, _at: string): GradeAccountRecord {
    const current = getGradeAccount(userId);
    const next = { ...current, plan: isGradePlan(plan) ? plan : current.plan };
    gradeAccounts.set(userId, next);
    return { ...next };
  }

  function addGradeCredits(userId: string, credits: number, _at: string, periodKey?: string): GradeAccountRecord {
    const add = Math.floor(credits);
    if (!Number.isFinite(add) || add <= 0) return getGradeAccount(userId);
    const current = getGradeAccount(userId);
    const next = {
      ...current,
      extraCredits: current.extraCredits + add,
      creditsPeriod: periodKey ?? current.creditsPeriod ?? null,
    };
    gradeAccounts.set(userId, next);
    return { ...next };
  }

  function ensureGradeAnchor(userId: string, at: string): GradeAccountRecord {
    const current = getGradeAccount(userId);
    if (!current.anchorAt) gradeAccounts.set(userId, { ...current, anchorAt: at });
    return getGradeAccount(userId);
  }

  function setBillingAnchor(userId: string, billingAnchorAt: string | null, at: string): GradeAccountRecord {
    const current = ensureGradeAnchor(userId, at);
    gradeAccounts.set(userId, { ...current, billingAnchorAt });
    return getGradeAccount(userId);
  }

  function getGradeQuotaUsage(userId: string, monthKey: string): number {
    return gradeUsage.get(usageKey(userId, monthKey)) ?? 0;
  }

  function consumeGradeQuota(userId: string, input: GradeQuotaConsumeInput): GradeQuotaConsumeResult {
    const usedThisMonth = getGradeQuotaUsage(userId, input.monthKey);
    const stored = getGradeAccount(userId);
    // Bought credits never expire (Sean, Oct 16); they're spent only after the monthly allowance.
    const account = stored;
    const decision = decideGradeConsume({
      usedThisMonth,
      monthlyLimit: input.monthlyLimit,
      extraCredits: input.noCredits ? 0 : account.extraCredits,
    });
    if (!decision.ok) {
      return { ok: false, usedThisMonth, extraCredits: account.extraCredits };
    }
    if (decision.source === "monthly") {
      const used = usedThisMonth + 1;
      gradeUsage.set(usageKey(userId, input.monthKey), used);
      return { ok: true, source: "monthly", usedThisMonth: used, extraCredits: account.extraCredits };
    }
    const extraCredits = account.extraCredits - 1;
    gradeAccounts.set(userId, { ...account, extraCredits });
    return { ok: true, source: "credit", usedThisMonth, extraCredits };
  }

  function getVendorQuotaUsage(provider: string, monthKey: string): number {
    return vendorUsage.get(vendorKey(provider, monthKey)) ?? 0;
  }

  function consumeVendorQuota(provider: string, monthKey: string, cap: number): boolean {
    const used = getVendorQuotaUsage(provider, monthKey);
    if (used >= cap) return false;
    vendorUsage.set(vendorKey(provider, monthKey), used + 1);
    return true;
  }

  const purchaseLedger = createMemoryPurchaseLedger();
  const recordPurchase = (item: InventoryItemRecord | undefined) => {
    if (item?.purchase) {
      purchaseLedger.record(item.userId, {
        purchaseId: item.purchase.purchaseId,
        inventoryItemId: item.inventoryItemId,
        purchasedAt: item.purchase.purchasedAt,
        snapshot: item.purchase,
        at: new Date().toISOString(),
      });
    }
    return item;
  };
  const port: StorePort = {
    accounts: undefined as unknown as AccountStore,
    sales: createMemorySalesStore(),
    purchaseLedger,
    idempotency: createMemoryIdempotencyStore(),
    consents: createMemoryConsentStore(),
    ageConfirmations: createMemoryAgeConfirmationStore(),
    gradeHistory: createMemoryGradeHistoryStore(),
    createSession,
    getSessionByToken,
    getPokecollectorUserMapping,
    savePokecollectorUserMapping,
    listPokecollectorUserMappings,
    deletePokecollectorUserMapping,
    countPokecollectorLinks,
    listInvitedUsers,
    getPreferences,
    setPreferences,
    inventoryItemWithLiveGuidance,
    getScan,
    listScans,
    saveScan,
    saveScanImage,
    readStoredScanImage,
    getScanImage,
    deleteScanImage,
    discardScanImage(scanId: string, storageRef: string) {
      const record = store.scanImages.get(scanId);
      if (!record || record.storageRef !== storageRef) return false;
      return store.scanImages.delete(scanId);
    },
    sweepOrphanScanImages(olderThan: Date) {
      let removed = 0;
      for (const [scanId, record] of [...store.scanImages]) {
        // Same 1-hour cutoff as the SQLite store: a scan in flight saves its image first.
        if ((scanImageSavedAt.get(record) ?? 0) >= olderThan.getTime()) continue;
        if (!store.scans.has(scanId)) {
          store.scanImages.delete(scanId);
          removed += 1;
        }
      }
      return removed;
    },
    saveGradeImage,
    getGradeImage,
    deleteGradeImage,
    deleteUserPhotos,
    // Memory store has no files; photos live in maps, so the count is taken up front.
    prepareUserPhotoDeletion: (userId: string) => {
      const result = deleteUserPhotos(userId);
      return () => result;
    },
    deleteUserScans,
    listScanUserIds,
    purgeExpiredGradePhotos,
    listInventory,
    confirmScan,
    rejectScan,
    getConfirmation,
    getCanonical,
    findCachedCanonicals,
    getInventoryItem,
    updateInventoryItem: (userId: string, inventoryItemId: string, patch: Partial<InventoryItemRecord>) =>
      recordPurchase(updateInventoryItem(userId, inventoryItemId, patch)),
    getDraft,
    listDrafts,
    getDraftForInventoryItem,
    saveDraft,
    saveInventoryItem: (item: InventoryItemRecord) => recordPurchase(saveInventoryItem(item))!,
    deleteInventoryItem: (userId: string, inventoryItemId: string) => {
      const deleted = deleteInventoryItem(userId, inventoryItemId);
      if (deleted) purchaseLedger.voidForItem(userId, inventoryItemId, new Date().toISOString());
      return deleted;
    },
    listGradingSubmitted,
    listGradingReturned,
    saveGradingSubmitted,
    saveGradingReturned,
    deleteGradingSubmitted,
    moveGradingSubmittedToReturned,
    getGradeEstimateCache,
    saveGradeEstimateCache,
    savePortfolioSnapshot,
    listPortfolioSnapshots,
    getGradeAccount,
    setGradePlan,
    addGradeCredits,
    ensureGradeAnchor,
    setBillingAnchor,
    getGradeQuotaUsage,
    consumeGradeQuota,
    getVendorQuotaUsage,
    consumeVendorQuota,
    ...confirmLog,
    saveUserPriceSnapshot(userId: string, snapshot: UserPriceSnapshot) {
      userPrices.push({ ...snapshot, userId });
      return { ...snapshot };
    },
    listUserPriceSnapshots(userId: string, tcgdexId: string, variant?: string | null) {
      return filterUserPriceSnapshots(userPrices, userId, tcgdexId, variant);
    },
    deleteUserPriceSnapshots(userId: string) {
      let n = 0;
      for (let i = userPrices.length - 1; i >= 0; i -= 1) if (userPrices[i]!.userId === userId) { userPrices.splice(i, 1); n += 1; }
      return n;
    },
  };
  port.accounts = createMemoryAccountStore(port, { gradeAccounts, gradeUsage });
  return port;
}

/** Memory twin of the SQLite account store (tests and `CARD_FLOW_STORE=memory`). */
function createMemoryAccountStore(
  port: StorePort,
  extra: { gradeAccounts: Map<string, GradeAccountRecord>; gradeUsage: Map<string, number> },
): AccountStore {
  const accounts = new Map<string, AccountRecord>();
  const resets = new Map<string, { userId: string; expiresAt: string; usedAt: string | null }>();
  const emailCodes = new Map<string, { codeHash: string; expiresAt: string; attempts: number }>();
  const sendsByAddressDay = new Map<string, number>();
  const byEmail = new Map<string, string>();
  const deletionAudit: DeletionAuditEntry[] = [];
  const northStarTotals = new Map<string, NorthStarWeekTotal>();
  const pendingDeletions = new Map<string, PokecollectorPendingDeletion>();
  const enqueueDeletion = ({ remoteUserId, mode, at }: { remoteUserId: string; mode: PokecollectorDeletionMode; at: string }) => {
    const existing = pendingDeletions.get(remoteUserId);
    pendingDeletions.set(remoteUserId, {
      remoteUserId,
      mode,
      attempts: existing?.attempts ?? 0,
      nextAttemptAt: at,
      createdAt: existing?.createdAt ?? at,
      lastResult: existing?.lastResult ?? null,
    });
  };
  const live = (s: StoredSession, now: string) => s.expiresAt > now;
  return {
    createAccount({ email, passwordHash, at }) {
      const normalized = normalizeEmail(email);
      if (byEmail.has(normalized)) return null;
      const record: AccountRecord = {
        userId: `acct_${crypto.randomUUID()}`,
        email: normalized,
        passwordHash,
        createdAt: at,
        emailVerifiedAt: null,
        verificationSends: 0,
      };
      accounts.set(record.userId, record);
      byEmail.set(normalized, record.userId);
      return { ...record };
    },
    findByEmail(email) {
      const id = byEmail.get(normalizeEmail(email));
      return id ? { ...accounts.get(id)! } : null;
    },
    createPasswordReset({ userId, tokenHash, expiresAt, at }) {
      for (const reset of resets.values()) if (reset.userId === userId && !reset.usedAt) reset.usedAt = at;
      resets.set(tokenHash, { userId, expiresAt, usedAt: null });
    },
    consumePasswordReset(tokenHash, now) {
      const reset = resets.get(tokenHash);
      if (!reset || reset.usedAt || reset.expiresAt <= now) return null;
      reset.usedAt = now;
      return reset.userId;
    },
    setPasswordHash(userId, passwordHash) {
      const account = accounts.get(userId);
      if (account) accounts.set(userId, { ...account, passwordHash });
    },
    isEmailVerified(userId) {
      return Boolean(accounts.get(userId)?.emailVerifiedAt);
    },
    takeVerificationSend(userId, cap) {
      const account = accounts.get(userId);
      if (!account || (account.verificationSends ?? 0) >= cap) return false;
      accounts.set(userId, { ...account, verificationSends: (account.verificationSends ?? 0) + 1 });
      return true;
    },
    takeEmailSendForAddress(email, day, cap) {
      const yesterday = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      for (const key of [...sendsByAddressDay.keys()]) if (key.split("\0")[1]! < yesterday) sendsByAddressDay.delete(key);
      const key = `${emailSendKey(email)}\0${day}`;
      const count = sendsByAddressDay.get(key) ?? 0;
      if (count >= cap) return false;
      sendsByAddressDay.set(key, count + 1);
      return true;
    },
    listUnverifiedAccountsBefore(cutoff) {
      return [...accounts.values()].filter((a) => !a.emailVerifiedAt && a.createdAt < cutoff).map((a) => a.userId);
    },
    createEmailVerification({ userId, codeHash, expiresAt }) {
      emailCodes.set(userId, { codeHash, expiresAt, attempts: 0 });
    },
    confirmEmailVerification(userId, codeHash, now) {
      const row = emailCodes.get(userId);
      if (!row || row.expiresAt <= now || row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) return "invalid";
      if (row.codeHash !== codeHash) {
        row.attempts += 1;
        return "invalid";
      }
      emailCodes.delete(userId);
      const account = accounts.get(userId);
      if (account && !account.emailVerifiedAt) accounts.set(userId, { ...account, emailVerifiedAt: now });
      return "verified";
    },
    recordDeletionAudit(entry) {
      deletionAudit.push({ ...entry });
    },
    listDeletionAudit() {
      return deletionAudit.map((entry) => ({ ...entry }));
    },
    listAccountUserIds() {
      return [...accounts.values()].map((account) => account.userId);
    },
    getAccount(userId) {
      const row = accounts.get(userId);
      return row ? { ...row } : null;
    },
    mintSession(userId, { guest, expiresAt, at }) {
      const token = mintSessionToken();
      const tokenHash = hashSessionToken(token);
      store.sessions.set(tokenHash, { sessionId: crypto.randomUUID(), tokenHash, userId, createdAt: at, expiresAt, isGuest: guest });
      return { token, userId, expiresAt };
    },
    purgeExpiredGuestSessions(now) {
      const expired = new Set<string>();
      for (const [hash, s] of store.sessions) {
        if (s.isGuest && !live(s, now)) {
          store.sessions.delete(hash);
          expired.add(s.userId);
        }
      }
      return [...expired];
    },
    hasLiveSession(userId, now) {
      return [...store.sessions.values()].some((s) => s.userId === userId && live(s, now));
    },
    deleteSessionsForUser(userId) {
      let n = 0;
      for (const [hash, s] of store.sessions) if (s.userId === userId) { store.sessions.delete(hash); n += 1; }
      return n;
    },
    moveGuestData(fromUserId, toUserId) {
      let scans = 0;
      for (const [id, scan] of store.scans) {
        if (scan.userId === fromUserId) { store.scans.set(id, { ...scan, userId: toUserId }); scans += 1; }
      }
      for (const [id, c] of store.confirmations) {
        if ((c as { userId?: string }).userId === fromUserId) store.confirmations.set(id, { ...c, userId: toUserId } as ConfirmationRecord);
      }
      // Policy Reviewer (Oct 17): guests never get CardSight, so no guest CardSight consent,
      // history or usage carries over at sign-up; the account answers for itself.
      port.consents.deleteUser(fromUserId);
      // Guests make no 18+ statement; nothing carries over (any stray row is dropped).
      (port.ageConfirmations as AgeConfirmationStore & { moveUser(from: string, to: string): void }).moveUser(fromUserId, toUserId);
      this.deleteSessionsForUser(fromUserId);
      return { scans, confirmEvents: 0 };
    },
    deleteAllUserRows(userId, options = {}) {
      const counts: Record<string, number> = {};
      for (const t of resolveNorthStarTotals(options.northStarTotals)) {
        const row = northStarTotals.get(t.weekStart) ?? { weekStart: t.weekStart, purchased: 0, scans: 0, activeResellers: 0 };
        northStarTotals.set(t.weekStart, {
          weekStart: t.weekStart,
          purchased: row.purchased + t.purchased,
          scans: row.scans + t.scans,
          activeResellers: row.activeResellers + t.activeResellers,
        });
      }
      port.deleteUserPhotos(userId);
      counts.crm_scans = port.deleteUserScans(userId);
      counts.scan_confirm_events = port.deleteUserConfirmEvents(userId);
      counts.user_price_snapshots = port.deleteUserPriceSnapshots(userId);
      counts.user_card_sales = port.sales.deleteUser(userId);
      counts.grade_estimate_history = port.gradeHistory.deleteUser(userId);
      // Backend review H2 (P4): hard-deleted; the weekly counts were added to the totals above.
      counts.purchase_events = port.purchaseLedger.deleteUser(userId);
      counts.idempotency_keys = port.idempotency.deleteUser(userId);
      counts.provider_consents = port.consents.deleteUser(userId);
      counts.age_confirmations = port.ageConfirmations.deleteUser(userId);
      for (const item of port.listInventory(userId)) port.deleteInventoryItem(userId, item.inventoryItemId);
      store.inventory = store.inventory.filter((item) => item.userId !== userId);
      for (const [id, c] of store.confirmations) if ((c as { userId?: string }).userId === userId) store.confirmations.delete(id);
      store.pokecollectorUsers.delete(userId);
      store.gradingSubmitted = store.gradingSubmitted.filter((row) => row.userId !== userId);
      store.gradingReturned = store.gradingReturned.filter((row) => row.userId !== userId);
      store.portfolioSnapshots.delete(userId);
      extra.gradeAccounts.delete(userId);
      for (const key of [...extra.gradeUsage.keys()]) if (key.startsWith(`${userId}\0`)) extra.gradeUsage.delete(key);
      counts.crm_sessions = this.deleteSessionsForUser(userId);
      for (const [hash, reset] of resets) if (reset.userId === userId) resets.delete(hash);
      emailCodes.delete(userId);
      if (accounts.has(userId)) {
        byEmail.delete(accounts.get(userId)!.email);
        accounts.delete(userId);
        counts.user_accounts = 1;
      }
      const remote = options.pokecollectorRemote;
      if (remote) {
        const others = port.countPokecollectorLinks(remote.remoteUserId);
        enqueueDeletion({ remoteUserId: remote.remoteUserId, mode: remote.hold || others > 0 ? "hold" : "delete", at: remote.at });
      }
      return counts;
    },
    listPokecollectorDeletions() {
      return [...pendingDeletions.values()]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.remoteUserId.localeCompare(b.remoteUserId))
        .map((row) => ({ ...row }));
    },
    listDuePokecollectorDeletions(now, limit) {
      return [...pendingDeletions.values()]
        .filter((row) => row.mode === "delete" && row.nextAttemptAt <= now)
        .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || a.remoteUserId.localeCompare(b.remoteUserId))
        .slice(0, limit)
        .map((row) => ({ ...row }));
    },
    enqueuePokecollectorDeletion: (entry) => enqueueDeletion(entry),
    updatePokecollectorDeletion(remoteUserId, patch) {
      const row = pendingDeletions.get(remoteUserId);
      if (row) pendingDeletions.set(remoteUserId, { ...row, ...patch });
    },
    removePokecollectorDeletion(remoteUserId) {
      pendingDeletions.delete(remoteUserId);
    },
    listNorthStarTotals() {
      return [...northStarTotals.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart)).map((t) => ({ ...t }));
    },
    listAllUserIds() {
      return [
        ...new Set([
          ...[...store.scans.values()].map((scan) => scan.userId),
          ...store.inventory.map((item) => item.userId),
          ...[...store.sessions.values()].map((s) => s.userId),
          ...accounts.keys(),
          ...port.purchaseLedger.listUserIds(),
          ...store.pokecollectorUsers.keys(),
          ...store.portfolioSnapshots.keys(),
          ...extra.gradeAccounts.keys(),
        ]),
      ];
    },
    countUserRows(userId) {
      return {
        purchase_events: port.purchaseLedger.list(userId).length,
        crm_scans: port.listScans(userId).length,
        crm_inventory_items: port.listInventory(userId).length,
        crm_sessions: [...store.sessions.values()].filter((s) => s.userId === userId).length,
        user_accounts: accounts.has(userId) ? 1 : 0,
      };
    },
  };
}
