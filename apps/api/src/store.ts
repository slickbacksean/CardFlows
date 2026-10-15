import { createMemoryGradeHistoryStore, type GradeHistoryStore } from "./grade-history-store";
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
  extraCredits: number;
}

export interface GradeQuotaConsumeInput {
  monthKey: string;
  monthlyLimit: number;
  at: string;
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

export function getSessionByToken(token: string): SessionRecord | undefined {
  const hashed = hashSessionToken(token);
  const session = store.sessions.get(hashed);
  if (!session || isSessionExpired(session.expiresAt)) return undefined;
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  };
}

export function getPokecollectorUserMapping(userId: string): PokecollectorUserMapping | undefined {
  return store.pokecollectorUsers.get(userId);
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
  /** P2-07 pre-grade estimate history. */
  gradeHistory: GradeHistoryStore;
  createSession: typeof createSession;
  getSessionByToken: typeof getSessionByToken;
  getPokecollectorUserMapping: typeof getPokecollectorUserMapping;
  savePokecollectorUserMapping: typeof savePokecollectorUserMapping;
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
  saveGradeImage: typeof saveGradeImage;
  getGradeImage: typeof getGradeImage;
  deleteGradeImage: typeof deleteGradeImage;
  deleteUserPhotos: typeof deleteUserPhotos;
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
  addGradeCredits: (userId: string, credits: number, at: string) => GradeAccountRecord;
  getGradeQuotaUsage: (userId: string, monthKey: string) => number;
  consumeGradeQuota: (userId: string, input: GradeQuotaConsumeInput) => GradeQuotaConsumeResult;
  getVendorQuotaUsage: (provider: string, monthKey: string) => number;
  consumeVendorQuota: (provider: string, monthKey: string, cap: number) => boolean;
}

const DEFAULT_GRADE_ACCOUNT: GradeAccountRecord = { plan: "free", extraCredits: 0 };

export function createMemoryStore(): StorePort {
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

  function addGradeCredits(userId: string, credits: number, _at: string): GradeAccountRecord {
    const add = Math.floor(credits);
    if (!Number.isFinite(add) || add <= 0) return getGradeAccount(userId);
    const current = getGradeAccount(userId);
    const next = { ...current, extraCredits: current.extraCredits + add };
    gradeAccounts.set(userId, next);
    return { ...next };
  }

  function getGradeQuotaUsage(userId: string, monthKey: string): number {
    return gradeUsage.get(usageKey(userId, monthKey)) ?? 0;
  }

  function consumeGradeQuota(userId: string, input: GradeQuotaConsumeInput): GradeQuotaConsumeResult {
    const usedThisMonth = getGradeQuotaUsage(userId, input.monthKey);
    const account = getGradeAccount(userId);
    const decision = decideGradeConsume({
      usedThisMonth,
      monthlyLimit: input.monthlyLimit,
      extraCredits: account.extraCredits,
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

  return {
    gradeHistory: createMemoryGradeHistoryStore(),
    createSession,
    getSessionByToken,
    getPokecollectorUserMapping,
    savePokecollectorUserMapping,
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
    saveGradeImage,
    getGradeImage,
    deleteGradeImage,
    deleteUserPhotos,
    purgeExpiredGradePhotos,
    listInventory,
    confirmScan,
    rejectScan,
    getConfirmation,
    getCanonical,
    findCachedCanonicals,
    getInventoryItem,
    updateInventoryItem,
    getDraft,
    listDrafts,
    getDraftForInventoryItem,
    saveDraft,
    saveInventoryItem,
    deleteInventoryItem,
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
    getGradeQuotaUsage,
    consumeGradeQuota,
    getVendorQuotaUsage,
    consumeVendorQuota,
  };
}
