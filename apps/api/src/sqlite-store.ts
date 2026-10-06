import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import {
  catalogFingerprint,
  cachedCatalogCardMatches,
  centsToDollarString,
  computeMaxBuy,
  confirmIdentity,
  DEFAULT_MAX_BUY_PREFERENCES,
  LISTING_AI_COPY_ENABLED,
  listInvitedIdentities,
  LOCKED_DISPLAY_CURRENCY,
  optionalDollarsToCents,
  RECOGNITION_SCENARIOS,
  requireInvitedIdentity,
  withLockedDisplayCurrency,
  type CachedCatalogQuery,
  type CaptureMethod,
  type CardFlowCanonicalCard,
  type CardFlowNormalizedRecognitionResult,
  type CatalogMappingResult,
  type GradeSide,
  type GradingReturnedCopy,
  type GradingSubmittedCopy,
  type InventoryIntent,
  type InvitedIdentity,
  type ListingDraft,
  type ListingDraftStatus,
  type MaxBuyPreferences,
  type RecognitionScenario,
  type TitleTemplateId,
  type TcgdexVariants,
} from "@cardflow/shared";
import { catalogDisplayFromCard } from "./listing";
import { applyMvpMigrations, isMemorySqlitePath } from "./db/migrate";
import {
  gradeImageStorageCandidates,
  gradeImageStorageRef,
  isFirstPartyGradeImageRef,
  mimeFromGradeStorageRef,
  type GradeImageBytes,
} from "./grade-image";
import {
  isFirstPartyScanImageRef,
  mimeFromScanStorageRef,
  normalizeScanImageMime,
  scanImageStorageRef,
  type ScanImageBytes,
  type ScanImageMimeType,
} from "./scan-image";
import {
  cardExternalIds,
  cardflowCards,
  crmConfirmations,
  crmGradingReturned,
  crmGradingSubmitted,
  gradeEstimateCache,
  portfolioValueSnapshots,
  crmInventoryItems,
  crmListingDrafts,
  crmPurchases,
  crmScans,
  crmSessions,
  crmPokecollectorUsers,
  userPreferences as userPreferencesTable,
} from "./db/schema";
import {
  hashSessionToken,
  isSessionExpired,
  mintSessionToken,
  sessionExpiryIso,
  type CreatedSession,
  type SessionRecord,
} from "./session";
import {
  inventoryItemWithLiveGuidance as overlayLiveMaxBuy,
  type ConfirmationRecord,
  type InventoryItemRecord,
  type PortfolioValueSnapshot,
  type ScanRecord,
  type StorePort,
} from "./store";
import type { PokecollectorUserMapping } from "./pokecollector-accounts";

export interface CreateSqliteStoreOptions {
  sqlitePath: string;
}

export interface SqliteStorePort extends StorePort {
  close(): void;
  readonly sqlitePath: string;
}

interface PersistedRecognitionEnvelope {
  scenario: RecognitionScenario;
  recognition: CardFlowNormalizedRecognitionResult;
}

function isScenario(value: unknown): value is RecognitionScenario {
  return typeof value === "string" && (RECOGNITION_SCENARIOS as string[]).includes(value);
}

function isCaptureMethod(value: unknown): value is CaptureMethod {
  return value === "camera_photo" || value === "manual_scan";
}

function dollarsFromCents(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  return centsToDollarString(cents);
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseTags(raw: string | null | undefined): string[] {
  const parsed = parseJson<unknown>(raw, ["raw"]);
  if (!Array.isArray(parsed)) return ["raw"];
  return parsed.filter((tag): tag is string => typeof tag === "string");
}

function parseVariants(raw: string): TcgdexVariants {
  const parsed = parseJson<Partial<TcgdexVariants>>(raw, {});
  return {
    firstEdition: Boolean(parsed.firstEdition),
    holo: Boolean(parsed.holo),
    normal: parsed.normal !== false,
    reverse: Boolean(parsed.reverse),
    wPromo: Boolean(parsed.wPromo),
  };
}

function serializeRecognition(scan: ScanRecord): string {
  const envelope: PersistedRecognitionEnvelope = {
    scenario: scan.scenario,
    recognition: scan.recognition,
  };
  return JSON.stringify(envelope);
}

function parseRecognition(raw: string): PersistedRecognitionEnvelope {
  const parsed = parseJson<unknown>(raw, {});
  if (
    parsed &&
    typeof parsed === "object" &&
    "recognition" in parsed &&
    "scenario" in parsed &&
    isScenario((parsed as PersistedRecognitionEnvelope).scenario)
  ) {
    return parsed as PersistedRecognitionEnvelope;
  }
  return {
    scenario: "high-confidence",
    recognition: parsed as CardFlowNormalizedRecognitionResult,
  };
}

function grainForIntent(intent: InventoryIntent): InventoryItemRecord["grain"] {
  return intent === "purchased" ? "physical_copy" : "interest_not_physical_copy";
}

function asDraftStatus(value: string): ListingDraftStatus {
  return value === "ready_for_review" ? "ready_for_review" : "draft";
}

function asTitleTemplateId(value: string): TitleTemplateId {
  return value === "en_raw_single_with_condition"
    ? "en_raw_single_with_condition"
    : "default_en_raw_single";
}

function emptyMapping(): CatalogMappingResult {
  return {
    provider: "mock",
    ok: false,
    confidence: "Unresolved",
    status: "no_match",
    matchedOn: [],
    cardflowCardId: null,
    tcgdexId: null,
    cardsightCardId: null,
    canonicalCard: null,
    candidates: [],
    error: null,
    userConfirmation: {
      required: true,
      crmWriteAllowedBeforeConfirm: false,
      recommendedUx: "search manually",
    },
    lookup: {
      language: "en",
      setName: null,
      resolvedSetId: null,
      localId: null,
      method: "none",
      nameVerified: false,
      nameOnlySearchForbiddenForAutoMap: true,
    },
  };
}

function catalogImageFromRow(card: {
  tcgdexId: string;
  language: string;
  imageBaseUrl: string | null;
}): CardFlowCanonicalCard["image"] {
  const baseUrl = card.imageBaseUrl ?? "";
  return {
    baseUrl,
    source: "tcgdex_assets",
    quality: "high",
    extension: "webp",
    constructedUrl: baseUrl ? `${baseUrl}/high.webp` : "",
    provenance: `tcgdex assets.tcgdex.net; card id ${card.tcgdexId}; lang ${card.language}; database not affiliated with Nintendo or The Pokémon Company`,
  };
}

export function createSqliteStore(options: CreateSqliteStoreOptions): SqliteStorePort {
  const { sqlite, db } = applyMvpMigrations(options.sqlitePath);
  const memoryImages = new Map<string, ScanImageBytes>();
  const memoryGradeImages = new Map<string, GradeImageBytes>();
  const sqliteDir = isMemorySqlitePath(options.sqlitePath)
    ? null
    : path.dirname(path.resolve(options.sqlitePath));

  function listInvitedUsers(): InvitedIdentity[] {
    return listInvitedIdentities();
  }

  function createSession(userId: string): CreatedSession {
    const identity = requireInvitedIdentity(userId);
    const token = mintSessionToken();
    const createdAt = new Date();
    const session: SessionRecord = {
      sessionId: crypto.randomUUID(),
      userId: identity.userId,
      createdAt: createdAt.toISOString(),
      expiresAt: sessionExpiryIso(createdAt),
    };
    db.insert(crmSessions)
      .values({
        sessionId: session.sessionId,
        tokenHash: hashSessionToken(token),
        userId: session.userId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      })
      .run();
    return { token, identity, session };
  }

  function getSessionByToken(token: string): SessionRecord | undefined {
    const row = db
      .select()
      .from(crmSessions)
      .where(eq(crmSessions.tokenHash, hashSessionToken(token)))
      .get();
    if (!row || isSessionExpired(row.expiresAt)) return undefined;
    return {
      sessionId: row.sessionId,
      userId: row.userId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }

  function getPokecollectorUserMapping(userId: string): PokecollectorUserMapping | undefined {
    const row = db
      .select()
      .from(crmPokecollectorUsers)
      .where(eq(crmPokecollectorUsers.userId, userId))
      .get();
    if (!row) return undefined;
    return {
      userId: row.userId,
      pokecollectorUserId: row.pokecollectorUserId,
      pokecollectorUsername: row.pokecollectorUsername,
      updatedAt: row.updatedAt,
    };
  }

  function savePokecollectorUserMapping(
    mapping: PokecollectorUserMapping,
  ): PokecollectorUserMapping {
    const values = {
      userId: mapping.userId,
      pokecollectorUserId: mapping.pokecollectorUserId,
      pokecollectorUsername: mapping.pokecollectorUsername,
      updatedAt: mapping.updatedAt,
    };
    db.insert(crmPokecollectorUsers)
      .values(values)
      .onConflictDoUpdate({
        target: crmPokecollectorUsers.userId,
        set: {
          pokecollectorUserId: values.pokecollectorUserId,
          pokecollectorUsername: values.pokecollectorUsername,
          updatedAt: values.updatedAt,
        },
      })
      .run();
    return mapping;
  }

  function getPreferences(userId: string): MaxBuyPreferences {
    const row = db
      .select()
      .from(userPreferencesTable)
      .where(eq(userPreferencesTable.userId, userId))
      .get();
    if (!row) return { ...DEFAULT_MAX_BUY_PREFERENCES };
    const cleaned = withLockedDisplayCurrency({
      targetMarginPct: row.maxBuyTargetMarginPct,
      feesBufferPct: row.maxBuyFeesBufferPct,
      conditionAdjustments: parseJson<Record<string, number> | null>(
        row.maxBuyConditionAdjustmentsJson,
        null,
      ),
      defaultCurrency: LOCKED_DISPLAY_CURRENCY,
    });
    const cleanedJson = cleaned.conditionAdjustments
      ? JSON.stringify(cleaned.conditionAdjustments)
      : null;
    if ((row.maxBuyConditionAdjustmentsJson ?? null) !== cleanedJson) {
      db.update(userPreferencesTable)
        .set({ maxBuyConditionAdjustmentsJson: cleanedJson })
        .where(eq(userPreferencesTable.userId, userId))
        .run();
    }
    return cleaned;
  }

  function setPreferences(userId: string, next: MaxBuyPreferences): MaxBuyPreferences {
    const stored = withLockedDisplayCurrency(next);
    const adjustmentsJson = stored.conditionAdjustments
      ? JSON.stringify(stored.conditionAdjustments)
      : null;
    db.insert(userPreferencesTable)
      .values({
        userId,
        defaultCurrency: LOCKED_DISPLAY_CURRENCY,
        defaultLanguage: "en",
        maxBuyTargetMarginPct: stored.targetMarginPct,
        maxBuyFeesBufferPct: stored.feesBufferPct,
        maxBuyConditionAdjustmentsJson: adjustmentsJson,
        defaultInventoryTag: "raw",
      })
      .onConflictDoUpdate({
        target: userPreferencesTable.userId,
        set: {
          defaultCurrency: LOCKED_DISPLAY_CURRENCY,
          maxBuyTargetMarginPct: stored.targetMarginPct,
          maxBuyFeesBufferPct: stored.feesBufferPct,
          maxBuyConditionAdjustmentsJson: adjustmentsJson,
        },
      })
      .run();
    return getPreferences(userId);
  }

  function cardsightIdForCard(cardflowCardId: string): string | null {
    const row = db
      .select()
      .from(cardExternalIds)
      .where(
        and(
          eq(cardExternalIds.cardflowCardId, cardflowCardId),
          eq(cardExternalIds.provider, "cardsight"),
        ),
      )
      .get();
    return row?.externalId ?? null;
  }

  function canonicalFromRow(
    row: typeof cardflowCards.$inferSelect,
    selectedVariant: string | null = null,
  ): CardFlowCanonicalCard {
    return {
      cardflowCardId: row.cardflowCardId,
      language: row.language,
      tcgdexId: row.tcgdexId,
      tcgdexSetId: row.tcgdexSetId,
      localId: row.localId,
      name: row.name,
      category: row.category,
      rarity: row.rarity,
      illustrator: null,
      variants: parseVariants(row.variantsJson),
      selectedVariant,
      set: { id: row.tcgdexSetId, name: row.setName },
      image: catalogImageFromRow(row),
      cardsightCardId: cardsightIdForCard(row.cardflowCardId),
      catalogFingerprint: catalogFingerprint(row.language, row.tcgdexId),
    };
  }

  function persistCanonical(card: CardFlowCanonicalCard, now: string): string {
    const incomingId = card.cardflowCardId;
    if (!incomingId) throw new Error("canonical card missing cardflow_card_id");
    const existing = db
      .select()
      .from(cardflowCards)
      .where(
        and(eq(cardflowCards.language, card.language), eq(cardflowCards.tcgdexId, card.tcgdexId)),
      )
      .get();
    const cache = {
      tcgdexSetId: card.tcgdexSetId,
      localId: card.localId,
      name: card.name,
      setName: card.set.name,
      rarity: card.rarity,
      category: card.category,
      variantsJson: JSON.stringify(card.variants),
      imageBaseUrl: card.image.baseUrl,
      imageSource: "tcgdex_assets" as const,
      updatedAt: now,
    };
    if (existing) {
      db.update(cardflowCards)
        .set(cache)
        .where(eq(cardflowCards.cardflowCardId, existing.cardflowCardId))
        .run();
      return existing.cardflowCardId;
    }
    db.insert(cardflowCards)
      .values({
        cardflowCardId: incomingId,
        language: card.language,
        tcgdexId: card.tcgdexId,
        ...cache,
      })
      .run();
    return incomingId;
  }

  function persistExternalIds(card: CardFlowCanonicalCard, matchMethod: string, now: string): void {
    const cardflowCardId = card.cardflowCardId;
    if (!cardflowCardId) return;
    db.insert(cardExternalIds)
      .values({
        id: crypto.randomUUID(),
        cardflowCardId,
        provider: "tcgdex",
        externalId: card.tcgdexId,
        setExternalId: card.tcgdexSetId,
        language: card.language,
        matchMethod,
        mappingConfidence: card.mappingConfidence ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [cardExternalIds.provider, cardExternalIds.externalId, cardExternalIds.language],
        set: {
          cardflowCardId,
          setExternalId: card.tcgdexSetId,
          matchMethod,
          mappingConfidence: card.mappingConfidence ?? null,
          updatedAt: now,
        },
      })
      .run();

    if (!card.cardsightCardId) return;
    db.insert(cardExternalIds)
      .values({
        id: crypto.randomUUID(),
        cardflowCardId,
        provider: "cardsight",
        externalId: card.cardsightCardId,
        setExternalId: card.tcgdexSetId,
        language: card.language,
        matchMethod,
        mappingConfidence: card.mappingConfidence ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [cardExternalIds.provider, cardExternalIds.externalId, cardExternalIds.language],
        set: {
          cardflowCardId,
          setExternalId: card.tcgdexSetId,
          matchMethod,
          mappingConfidence: card.mappingConfidence ?? null,
          updatedAt: now,
        },
      })
      .run();
  }

  function getCanonical(cardflowCardId: string): CardFlowCanonicalCard | undefined {
    const row = db
      .select()
      .from(cardflowCards)
      .where(eq(cardflowCards.cardflowCardId, cardflowCardId))
      .get();
    return row ? canonicalFromRow(row) : undefined;
  }

  function findCachedCanonicals(query: CachedCatalogQuery): CardFlowCanonicalCard[] {
    const language = query.language ?? "en";
    return db
      .select()
      .from(cardflowCards)
      .where(eq(cardflowCards.language, language))
      .all()
      .map((row) => canonicalFromRow(row))
      .filter((card) => cachedCatalogCardMatches(card, query));
  }

  function confirmationIdForScan(scanId: string): string | null {
    const row = db
      .select()
      .from(crmConfirmations)
      .where(eq(crmConfirmations.scanId, scanId))
      .orderBy(desc(crmConfirmations.confirmedAt))
      .get();
    return row?.confirmationId ?? null;
  }

  function inventoryItemIdForScan(scanId: string): string | null {
    const row = db
      .select()
      .from(crmInventoryItems)
      .where(eq(crmInventoryItems.scanId, scanId))
      .orderBy(desc(crmInventoryItems.createdAt))
      .get();
    return row?.inventoryItemId ?? null;
  }

  function scanFromRow(row: typeof crmScans.$inferSelect): ScanRecord {
    const envelope = parseRecognition(row.recognitionJson);
    const mapping = row.mappingJson
      ? parseJson<CatalogMappingResult>(row.mappingJson, emptyMapping())
      : emptyMapping();

    return {
      scanId: row.scanId,
      userId: row.userId,
      capturedAt: row.capturedAt,
      captureMethod: isCaptureMethod(row.captureMethod) ? row.captureMethod : "camera_photo",
      scenario: envelope.scenario,
      preInventoryState:
        row.preInventoryState === "identity_confirmed" ||
        row.preInventoryState === "identity_rejected"
          ? row.preInventoryState
          : "scan_captured",
      cardflowCardId: row.cardflowCardId,
      confirmationId: confirmationIdForScan(row.scanId),
      inventoryItemId: inventoryItemIdForScan(row.scanId),
      imageStorageRef: row.imageStorageRef,
      imageMimeType: normalizeScanImageMime(row.imageMimeType),
      recognition: envelope.recognition,
      mapping,
    };
  }

  function persistScan(scan: ScanRecord): void {
    const values = {
      scanId: scan.scanId,
      userId: scan.userId,
      capturedAt: scan.capturedAt,
      captureMethod: scan.captureMethod,
      imageStorageRef: scan.imageStorageRef,
      imageSource: "user_capture",
      imageMimeType: scan.imageMimeType,
      recognitionJson: serializeRecognition(scan),
      mappingJson: JSON.stringify(scan.mapping),
      mappingStatus: scan.mapping.status,
      mappingConfidence: scan.mapping.confidence,
      preInventoryState: scan.preInventoryState,
      cardflowCardId: scan.cardflowCardId,
      cardsightCardId: scan.mapping.cardsightCardId,
      vendorRequestId: scan.recognition.vendorRequestId,
    };
    db.insert(crmScans)
      .values(values)
      .onConflictDoUpdate({
        target: crmScans.scanId,
        set: {
          capturedAt: values.capturedAt,
          captureMethod: values.captureMethod,
          imageStorageRef: values.imageStorageRef,
          imageMimeType: values.imageMimeType,
          recognitionJson: values.recognitionJson,
          mappingJson: values.mappingJson,
          mappingStatus: values.mappingStatus,
          mappingConfidence: values.mappingConfidence,
          preInventoryState: values.preInventoryState,
          cardflowCardId: values.cardflowCardId,
          cardsightCardId: values.cardsightCardId,
          vendorRequestId: values.vendorRequestId,
        },
      })
      .run();
  }

  function getScan(userId: string, scanId: string): ScanRecord | undefined {
    const row = db
      .select()
      .from(crmScans)
      .where(and(eq(crmScans.scanId, scanId), eq(crmScans.userId, userId)))
      .get();
    return row ? scanFromRow(row) : undefined;
  }

  function listScans(userId: string): ScanRecord[] {
    return db
      .select()
      .from(crmScans)
      .where(eq(crmScans.userId, userId))
      .orderBy(desc(crmScans.capturedAt))
      .all()
      .map(scanFromRow);
  }

  function saveScan(scan: ScanRecord): ScanRecord {
    persistScan(scan);
    return scan;
  }

  function saveScanImage(
    scanId: string,
    input: { bytes: Uint8Array; mimeType: ScanImageMimeType },
  ): ScanImageBytes {
    const record: ScanImageBytes = {
      storageRef: scanImageStorageRef(scanId, input.mimeType),
      mimeType: input.mimeType,
      bytes: input.bytes,
    };
    if (!sqliteDir) {
      memoryImages.set(scanId, record);
      return record;
    }
    const filePath = path.join(sqliteDir, record.storageRef);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, record.bytes);
    return record;
  }

  function readStoredScanImage(scanId: string, storageRef: string): ScanImageBytes | undefined {
    if (!isFirstPartyScanImageRef(storageRef)) return undefined;
    const mimeType = mimeFromScanStorageRef(storageRef);
    if (!mimeType) return undefined;
    if (scanImageStorageRef(scanId, mimeType) !== storageRef) return undefined;
    if (!sqliteDir) {
      const record = memoryImages.get(scanId);
      if (!record || record.storageRef !== storageRef) return undefined;
      return record;
    }
    const filePath = path.join(sqliteDir, storageRef);
    if (!existsSync(filePath)) return undefined;
    return {
      storageRef,
      mimeType,
      bytes: new Uint8Array(readFileSync(filePath)),
    };
  }

  function getScanImage(userId: string, scanId: string): ScanImageBytes | undefined {
    const scan = getScan(userId, scanId);
    if (!scan?.imageStorageRef || !scan.imageMimeType) return undefined;
    return readStoredScanImage(scanId, scan.imageStorageRef);
  }

  function saveGradeImage(
    userId: string,
    inventoryItemId: string,
    side: GradeSide,
    input: { bytes: Uint8Array; mimeType: ScanImageMimeType },
  ): GradeImageBytes | undefined {
    if (!getInventoryItem(userId, inventoryItemId)) return undefined;
    const record: GradeImageBytes = {
      storageRef: gradeImageStorageRef(inventoryItemId, side, input.mimeType),
      mimeType: input.mimeType,
      bytes: input.bytes,
    };
    for (const candidate of gradeImageStorageCandidates(inventoryItemId, side)) {
      if (candidate === record.storageRef) continue;
      memoryGradeImages.delete(candidate);
      if (sqliteDir) {
        const stale = path.join(sqliteDir, candidate);
        if (existsSync(stale)) unlinkSync(stale);
      }
    }
    if (!sqliteDir) {
      memoryGradeImages.set(record.storageRef, record);
      return record;
    }
    const filePath = path.join(sqliteDir, record.storageRef);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, record.bytes);
    return record;
  }

  function getGradeImage(
    userId: string,
    inventoryItemId: string,
    side: GradeSide,
  ): GradeImageBytes | undefined {
    if (!getInventoryItem(userId, inventoryItemId)) return undefined;
    for (const candidate of gradeImageStorageCandidates(inventoryItemId, side)) {
      if (!isFirstPartyGradeImageRef(candidate)) continue;
      const mimeType = mimeFromGradeStorageRef(candidate);
      if (!mimeType) continue;
      if (!sqliteDir) {
        const record = memoryGradeImages.get(candidate);
        if (record && record.storageRef === candidate) return record;
        continue;
      }
      const filePath = path.join(sqliteDir, candidate);
      if (!existsSync(filePath)) continue;
      return {
        storageRef: candidate,
        mimeType,
        bytes: new Uint8Array(readFileSync(filePath)),
      };
    }
    return undefined;
  }

  function confirmationFromRow(row: typeof crmConfirmations.$inferSelect): ConfirmationRecord {
    const earlier = db
      .select()
      .from(crmConfirmations)
      .where(eq(crmConfirmations.cardflowCardId, row.cardflowCardId))
      .all()
      .filter(
        (other) =>
          other.confirmationId !== row.confirmationId && other.confirmedAt < row.confirmedAt,
      );
    return {
      confirmationId: row.confirmationId,
      scanId: row.scanId,
      cardflowCardId: row.cardflowCardId,
      tcgdexId: row.tcgdexId,
      language: row.language,
      selectedVariant: row.selectedVariant,
      matchMethod: row.matchMethod,
      confirmedAt: row.confirmedAt,
      mintedCardflowCardId: earlier.length === 0,
    };
  }

  function getConfirmation(
    userId: string,
    confirmationId: string,
  ): ConfirmationRecord | undefined {
    const row = db
      .select()
      .from(crmConfirmations)
      .where(eq(crmConfirmations.confirmationId, confirmationId))
      .get();
    if (!row) return undefined;
    return getScan(userId, row.scanId) ? confirmationFromRow(row) : undefined;
  }

  function confirmScan(input: {
    scan: ScanRecord;
    selectedTcgdexId: string;
    selectedVariant?: string | null;
    catalogCard?: CardFlowCanonicalCard | null;
  }): {
    scan: ScanRecord;
    confirmation: ConfirmationRecord;
    canonicalCard: CardFlowCanonicalCard;
  } {
    const existing = db
      .select()
      .from(cardflowCards)
      .where(
        and(eq(cardflowCards.language, "en"), eq(cardflowCards.tcgdexId, input.selectedTcgdexId)),
      )
      .get();
    const existingCanonical = existing ? canonicalFromRow(existing) : undefined;
    const catalogCard =
      input.catalogCard !== undefined
        ? input.catalogCard ?? existingCanonical ?? null
        : undefined;
    const confirmed = confirmIdentity({
      mapping: input.scan.mapping,
      selectedTcgdexId: input.selectedTcgdexId,
      selectedVariant: input.selectedVariant,
      existingCardflowCardId: existing?.cardflowCardId ?? null,
      catalogCard,
    });
    const now = new Date().toISOString();
    let canonicalCard = confirmed.canonicalCard;
    const confirmation: ConfirmationRecord = {
      confirmationId: crypto.randomUUID(),
      scanId: input.scan.scanId,
      cardflowCardId: canonicalCard.cardflowCardId as string,
      tcgdexId: input.selectedTcgdexId,
      language: "en",
      selectedVariant: input.selectedVariant ?? null,
      matchMethod: confirmed.matchMethod,
      confirmedAt: now,
      mintedCardflowCardId: confirmed.mintedCardflowCardId,
    };
    const scan: ScanRecord = {
      ...input.scan,
      preInventoryState: "identity_confirmed",
      cardflowCardId: confirmation.cardflowCardId,
      confirmationId: confirmation.confirmationId,
    };

    sqlite.transaction(() => {
      const persistedId = persistCanonical(canonicalCard, now);
      canonicalCard = { ...canonicalCard, cardflowCardId: persistedId };
      confirmation.cardflowCardId = persistedId;
      scan.cardflowCardId = persistedId;
      persistExternalIds(canonicalCard, confirmed.matchMethod, now);
      persistScan(scan);
      db.insert(crmConfirmations)
        .values({
          confirmationId: confirmation.confirmationId,
          scanId: scan.scanId,
          userId: scan.userId,
          cardflowCardId: confirmation.cardflowCardId,
          tcgdexId: confirmation.tcgdexId,
          language: confirmation.language,
          selectedVariant: confirmation.selectedVariant,
          matchMethod: confirmation.matchMethod,
          mappingConfidence: canonicalCard.mappingConfidence ?? null,
          previousTcgdexId: null,
          confirmedAt: confirmation.confirmedAt,
        })
        .run();
    })();

    return { scan, confirmation, canonicalCard };
  }

  function rejectScan(scan: ScanRecord): ScanRecord | null {
    if (scan.preInventoryState === "identity_confirmed") return null;
    if (scan.preInventoryState === "identity_rejected") return scan;
    const next: ScanRecord = {
      ...scan,
      preInventoryState: "identity_rejected",
      cardflowCardId: null,
      confirmationId: null,
    };
    persistScan(next);
    return next;
  }

  function purchaseFromRow(
    item: typeof crmInventoryItems.$inferSelect,
    purchase: typeof crmPurchases.$inferSelect,
  ): InventoryItemRecord["purchase"] {
    const maxBuy = computeMaxBuy({
      referencePriceAmount: dollarsFromCents(
        purchase.referencePriceAmount ?? item.referencePriceAmount,
      ),
      condition: item.condition,
      preferences: getPreferences(item.userId),
    });
    return {
      purchaseId: purchase.purchaseId,
      purchasedAt: purchase.purchasedAt,
      currency: purchase.currency,
      costBasis: {
        purchasePrice: centsToDollarString(purchase.purchasePrice),
        shipping: centsToDollarString(purchase.shipping),
        tax: centsToDollarString(purchase.tax),
        fees: centsToDollarString(purchase.fees),
        supplies: centsToDollarString(purchase.supplies),
        allInTotal: centsToDollarString(purchase.allInTotal),
      },
      maxBuy,
    };
  }

  function inventoryFromRows(
    item: typeof crmInventoryItems.$inferSelect,
    purchase: typeof crmPurchases.$inferSelect | null,
  ): InventoryItemRecord {
    const intent: InventoryIntent = item.intent === "watchlist" ? "watchlist" : "purchased";
    return {
      inventoryItemId: item.inventoryItemId,
      userId: item.userId,
      cardflowCardId: item.cardflowCardId,
      confirmationId: item.confirmationId,
      scanId: item.scanId ?? "",
      intent,
      grain: grainForIntent(intent),
      selectedVariant: item.selectedVariant,
      condition: item.condition,
      quantity: item.quantity,
      tags: parseTags(item.tags),
      workflowState:
        item.workflowState === "drafted"
          ? "drafted"
          : item.workflowState === "watching"
            ? "watching"
            : "acquired",
      referencePriceAmount: dollarsFromCents(item.referencePriceAmount),
      targetMaxBuyAmount: dollarsFromCents(item.targetMaxBuyAmount),
      createdAt: item.createdAt,
      purchase: purchase ? purchaseFromRow(item, purchase) : null,
    };
  }

  function loadInventoryItem(
    userId: string,
    inventoryItemId: string,
  ): InventoryItemRecord | undefined {
    const row = db
      .select({
        item: crmInventoryItems,
        purchase: crmPurchases,
      })
      .from(crmInventoryItems)
      .leftJoin(crmPurchases, eq(crmPurchases.inventoryItemId, crmInventoryItems.inventoryItemId))
      .where(
        and(
          eq(crmInventoryItems.inventoryItemId, inventoryItemId),
          eq(crmInventoryItems.userId, userId),
        ),
      )
      .get();
    if (!row?.item) return undefined;
    return inventoryFromRows(row.item, row.purchase);
  }

  function listInventory(userId: string): InventoryItemRecord[] {
    return db
      .select({
        item: crmInventoryItems,
        purchase: crmPurchases,
      })
      .from(crmInventoryItems)
      .leftJoin(crmPurchases, eq(crmPurchases.inventoryItemId, crmInventoryItems.inventoryItemId))
      .where(eq(crmInventoryItems.userId, userId))
      .orderBy(desc(crmInventoryItems.createdAt))
      .all()
      .filter((row) => row.item)
      .map((row) => inventoryFromRows(row.item, row.purchase));
  }

  function persistPurchase(item: InventoryItemRecord): void {
    if (!item.purchase) return;
    const cost = item.purchase.costBasis;
    const referenceCents = optionalDollarsToCents(
      item.referencePriceAmount ?? item.purchase.maxBuy.referencePriceAmount,
    );
    const purchasePrice = optionalDollarsToCents(cost.purchasePrice) ?? 0;
    const shipping = optionalDollarsToCents(cost.shipping) ?? 0;
    const tax = optionalDollarsToCents(cost.tax) ?? 0;
    const fees = optionalDollarsToCents(cost.fees) ?? 0;
    const supplies = optionalDollarsToCents(cost.supplies) ?? 0;
    const allInTotal = optionalDollarsToCents(cost.allInTotal) ?? 0;
    const maxBuyAmount = optionalDollarsToCents(item.purchase.maxBuy.maxBuyAmount);
    db.insert(crmPurchases)
      .values({
        purchaseId: item.purchase.purchaseId,
        inventoryItemId: item.inventoryItemId,
        purchasedAt: item.purchase.purchasedAt,
        sourceNote: null,
        currency: item.purchase.currency,
        purchasePrice,
        shipping,
        tax,
        fees,
        supplies,
        allInTotal,
        notes: null,
        maxBuyAmount,
        referencePriceAmount: referenceCents,
        referencePriceSource: referenceCents === null ? "none" : "user_entered",
      })
      .onConflictDoUpdate({
        target: crmPurchases.inventoryItemId,
        set: {
          purchasedAt: item.purchase.purchasedAt,
          currency: item.purchase.currency,
          purchasePrice,
          shipping,
          tax,
          fees,
          supplies,
          allInTotal,
          maxBuyAmount,
          referencePriceAmount: referenceCents,
          referencePriceSource: referenceCents === null ? "none" : "user_entered",
        },
      })
      .run();
  }

  function persistInventoryItem(item: InventoryItemRecord): void {
    const now = new Date().toISOString();
    db.insert(crmInventoryItems)
      .values({
        inventoryItemId: item.inventoryItemId,
        userId: item.userId,
        cardflowCardId: item.cardflowCardId,
        confirmationId: item.confirmationId,
        scanId: item.scanId || null,
        intent: item.intent,
        selectedVariant: item.selectedVariant,
        condition: item.condition,
        quantity: item.quantity,
        tags: JSON.stringify(item.tags),
        workflowState: item.workflowState,
        targetMaxBuyAmount: optionalDollarsToCents(item.targetMaxBuyAmount),
        referencePriceAmount: optionalDollarsToCents(item.referencePriceAmount),
        closedAt: null,
        createdAt: item.createdAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: crmInventoryItems.inventoryItemId,
        set: {
          selectedVariant: item.selectedVariant,
          condition: item.condition,
          quantity: item.quantity,
          tags: JSON.stringify(item.tags),
          workflowState: item.workflowState,
          targetMaxBuyAmount: optionalDollarsToCents(item.targetMaxBuyAmount),
          referencePriceAmount: optionalDollarsToCents(item.referencePriceAmount),
          updatedAt: now,
        },
      })
      .run();
    persistPurchase(item);
  }

  function getInventoryItem(
    userId: string,
    inventoryItemId: string,
  ): InventoryItemRecord | undefined {
    return loadInventoryItem(userId, inventoryItemId);
  }

  function updateInventoryItem(
    userId: string,
    inventoryItemId: string,
    patch: Partial<InventoryItemRecord>,
  ): InventoryItemRecord | undefined {
    const current = loadInventoryItem(userId, inventoryItemId);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    persistInventoryItem(next);
    return loadInventoryItem(userId, inventoryItemId);
  }

  function saveInventoryItem(item: InventoryItemRecord): InventoryItemRecord {
    persistInventoryItem(item);
    return item;
  }

  function draftFromRow(
    row: typeof crmListingDrafts.$inferSelect,
    selectedVariant: string | null,
  ): ListingDraft {
    const card = getCanonical(row.cardflowCardId);
    return {
      draftId: row.draftId,
      inventoryItemId: row.inventoryItemId,
      userId: row.userId,
      cardflowCardId: row.cardflowCardId,
      status: asDraftStatus(row.status),
      title: row.title,
      description: row.description,
      condition: row.condition,
      askingPrice: dollarsFromCents(row.askingPrice),
      currency: row.currency,
      quantity: 1,
      intendedChannelNote: row.intendedChannelNote,
      notes: row.notes,
      titleTemplateId: asTitleTemplateId(row.titleTemplateId),
      catalogDisplay: card
        ? catalogDisplayFromCard(card, selectedVariant)
        : {
            name: "",
            setName: "",
            localId: "",
            language: "en",
            rarity: null,
            selectedVariant,
            image: {
              baseUrl: "",
              source: "tcgdex_assets",
              quality: "high",
              extension: "webp",
              constructedUrl: "",
              provenance: "",
              notAUserListingPhoto: true as const,
            },
          },
      publication: { published: false, marketplace: null },
      aiCopyEnabled: LISTING_AI_COPY_ENABLED,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function selectedVariantForInventory(inventoryItemId: string): string | null {
    const item = db
      .select()
      .from(crmInventoryItems)
      .where(eq(crmInventoryItems.inventoryItemId, inventoryItemId))
      .get();
    return item?.selectedVariant ?? null;
  }

  function getDraft(userId: string, draftId: string): ListingDraft | undefined {
    const row = db
      .select()
      .from(crmListingDrafts)
      .where(and(eq(crmListingDrafts.draftId, draftId), eq(crmListingDrafts.userId, userId)))
      .get();
    if (!row) return undefined;
    return draftFromRow(row, selectedVariantForInventory(row.inventoryItemId));
  }

  function listDrafts(userId: string): ListingDraft[] {
    return db
      .select()
      .from(crmListingDrafts)
      .where(eq(crmListingDrafts.userId, userId))
      .orderBy(desc(crmListingDrafts.createdAt))
      .all()
      .map((row) => draftFromRow(row, selectedVariantForInventory(row.inventoryItemId)));
  }

  function getDraftForInventoryItem(
    userId: string,
    inventoryItemId: string,
  ): ListingDraft | undefined {
    if (!getInventoryItem(userId, inventoryItemId)) return undefined;
    const row = db
      .select()
      .from(crmListingDrafts)
      .where(eq(crmListingDrafts.inventoryItemId, inventoryItemId))
      .get();
    if (!row || row.userId !== userId) return undefined;
    return draftFromRow(row, selectedVariantForInventory(inventoryItemId));
  }

  function saveDraft(draft: ListingDraft): ListingDraft {
    const values = {
      draftId: draft.draftId,
      inventoryItemId: draft.inventoryItemId,
      userId: draft.userId,
      cardflowCardId: draft.cardflowCardId,
      status: draft.status,
      title: draft.title,
      description: draft.description,
      condition: draft.condition,
      askingPrice: optionalDollarsToCents(draft.askingPrice),
      currency: draft.currency,
      quantity: 1,
      photosJson: "[]",
      intendedChannelNote: draft.intendedChannelNote,
      notes: draft.notes,
      titleTemplateId: draft.titleTemplateId,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
    db.insert(crmListingDrafts)
      .values(values)
      .onConflictDoUpdate({
        target: crmListingDrafts.draftId,
        set: {
          status: values.status,
          title: values.title,
          description: values.description,
          condition: values.condition,
          askingPrice: values.askingPrice,
          currency: values.currency,
          intendedChannelNote: values.intendedChannelNote,
          notes: values.notes,
          titleTemplateId: values.titleTemplateId,
          updatedAt: values.updatedAt,
        },
      })
      .run();
    return draft;
  }

  function parsePillarAnswers(json: string): Record<string, string> {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      );
    } catch {
      return {};
    }
  }

  function submittedFromRow(row: typeof crmGradingSubmitted.$inferSelect): GradingSubmittedCopy {
    return {
      userId: row.userId,
      inventoryItemId: row.inventoryItemId,
      name: row.name,
      localId: row.localId,
      imageUrl: row.imageUrl,
      condition: row.condition,
      pillarAnswers: parsePillarAnswers(row.pillarAnswersJson),
      serviceLevelNote: row.serviceLevelNote,
      maxBuyAmount: row.maxBuyAmount,
      submittedAt: row.submittedAt,
      orderNumber: row.orderNumber,
      company: row.company,
      status: row.status === "at_grader" ? "at_grader" : "sent",
      estimateJson: row.estimateJson,
    };
  }

  function returnedFromRow(row: typeof crmGradingReturned.$inferSelect): GradingReturnedCopy {
    return {
      userId: row.userId,
      inventoryItemId: row.inventoryItemId,
      name: row.name,
      localId: row.localId,
      imageUrl: row.imageUrl,
      certNumber: row.certNumber,
      returnedGrade: row.returnedGrade,
      returnedAt: row.returnedAt,
    };
  }

  function listGradingSubmitted(userId: string): GradingSubmittedCopy[] {
    return db
      .select()
      .from(crmGradingSubmitted)
      .where(eq(crmGradingSubmitted.userId, userId))
      .orderBy(desc(crmGradingSubmitted.submittedAt))
      .all()
      .map(submittedFromRow);
  }

  function listGradingReturned(userId: string): GradingReturnedCopy[] {
    return db
      .select()
      .from(crmGradingReturned)
      .where(eq(crmGradingReturned.userId, userId))
      .orderBy(desc(crmGradingReturned.returnedAt))
      .all()
      .map(returnedFromRow);
  }

  function saveGradingSubmitted(copy: GradingSubmittedCopy): GradingSubmittedCopy {
    const values = {
      inventoryItemId: copy.inventoryItemId,
      userId: copy.userId,
      name: copy.name,
      localId: copy.localId,
      imageUrl: copy.imageUrl,
      condition: copy.condition,
      pillarAnswersJson: JSON.stringify(copy.pillarAnswers),
      serviceLevelNote: copy.serviceLevelNote,
      maxBuyAmount: copy.maxBuyAmount,
      estimateJson: copy.estimateJson,
      submittedAt: copy.submittedAt,
      orderNumber: copy.orderNumber,
      company: copy.company,
      status: copy.status,
    };
    db.insert(crmGradingSubmitted)
      .values(values)
      .onConflictDoUpdate({
        target: crmGradingSubmitted.inventoryItemId,
        set: {
          name: values.name,
          localId: values.localId,
          imageUrl: values.imageUrl,
          condition: values.condition,
          pillarAnswersJson: values.pillarAnswersJson,
          serviceLevelNote: values.serviceLevelNote,
          maxBuyAmount: values.maxBuyAmount,
          estimateJson: values.estimateJson,
          orderNumber: values.orderNumber,
          company: values.company,
          status: values.status,
        },
      })
      .run();
    return copy;
  }

  function saveGradingReturned(copy: GradingReturnedCopy): GradingReturnedCopy {
    const values = {
      inventoryItemId: copy.inventoryItemId,
      userId: copy.userId,
      name: copy.name,
      localId: copy.localId,
      imageUrl: copy.imageUrl,
      certNumber: copy.certNumber,
      returnedGrade: copy.returnedGrade,
      returnedAt: copy.returnedAt,
    };
    db.insert(crmGradingReturned)
      .values(values)
      .onConflictDoUpdate({
        target: crmGradingReturned.inventoryItemId,
        set: {
          name: values.name,
          localId: values.localId,
          imageUrl: values.imageUrl,
          certNumber: values.certNumber,
          returnedGrade: values.returnedGrade,
        },
      })
      .run();
    return copy;
  }

  function deleteGradingSubmitted(userId: string, inventoryItemId: string): void {
    db.delete(crmGradingSubmitted)
      .where(
        and(
          eq(crmGradingSubmitted.userId, userId),
          eq(crmGradingSubmitted.inventoryItemId, inventoryItemId),
        ),
      )
      .run();
  }

  function moveGradingSubmittedToReturned(copy: GradingReturnedCopy): void {
    const values = {
      inventoryItemId: copy.inventoryItemId,
      userId: copy.userId,
      name: copy.name,
      localId: copy.localId,
      imageUrl: copy.imageUrl,
      certNumber: copy.certNumber,
      returnedGrade: copy.returnedGrade,
      returnedAt: copy.returnedAt,
    };
    sqlite.transaction(() => {
      db.delete(crmGradingSubmitted)
        .where(
          and(
            eq(crmGradingSubmitted.userId, copy.userId),
            eq(crmGradingSubmitted.inventoryItemId, copy.inventoryItemId),
          ),
        )
        .run();
      db.insert(crmGradingReturned)
        .values(values)
        .onConflictDoUpdate({
          target: crmGradingReturned.inventoryItemId,
          set: {
            name: values.name,
            localId: values.localId,
            imageUrl: values.imageUrl,
            certNumber: values.certNumber,
            returnedGrade: values.returnedGrade,
          },
        })
        .run();
    })();
  }

  function getGradeEstimateCache(
    userId: string,
    inventoryItemId: string,
  ): { photoHash: string; estimateJson: string } | undefined {
    const row = db
      .select()
      .from(gradeEstimateCache)
      .where(
        and(
          eq(gradeEstimateCache.userId, userId),
          eq(gradeEstimateCache.inventoryItemId, inventoryItemId),
        ),
      )
      .get();
    if (!row) return undefined;
    return { photoHash: row.photoHash, estimateJson: row.estimateJson };
  }

  function saveGradeEstimateCache(
    userId: string,
    inventoryItemId: string,
    record: { photoHash: string; estimateJson: string },
  ): void {
    db.insert(gradeEstimateCache)
      .values({
        userId,
        inventoryItemId,
        photoHash: record.photoHash,
        estimateJson: record.estimateJson,
      })
      .onConflictDoUpdate({
        target: [gradeEstimateCache.userId, gradeEstimateCache.inventoryItemId],
        set: {
          photoHash: record.photoHash,
          estimateJson: record.estimateJson,
        },
      })
      .run();
  }

  function savePortfolioSnapshot(
    userId: string,
    snapshot: PortfolioValueSnapshot,
  ): PortfolioValueSnapshot {
    db.insert(portfolioValueSnapshots)
      .values({
        userId,
        snapshotDate: snapshot.date,
        amountCents: snapshot.amountCents,
        currency: snapshot.currency,
        pricedCopies: snapshot.pricedCopies,
        totalCopies: snapshot.totalCopies,
        recordedAt: snapshot.recordedAt,
      })
      .onConflictDoUpdate({
        target: [portfolioValueSnapshots.userId, portfolioValueSnapshots.snapshotDate],
        set: {
          amountCents: snapshot.amountCents,
          currency: snapshot.currency,
          pricedCopies: snapshot.pricedCopies,
          totalCopies: snapshot.totalCopies,
          recordedAt: snapshot.recordedAt,
        },
      })
      .run();
    return snapshot;
  }

  function listPortfolioSnapshots(
    userId: string,
    sinceDate?: string | null,
  ): PortfolioValueSnapshot[] {
    const where = sinceDate
      ? and(
          eq(portfolioValueSnapshots.userId, userId),
          gte(portfolioValueSnapshots.snapshotDate, sinceDate),
        )
      : eq(portfolioValueSnapshots.userId, userId);
    return db
      .select()
      .from(portfolioValueSnapshots)
      .where(where)
      .orderBy(asc(portfolioValueSnapshots.snapshotDate))
      .all()
      .map((row) => ({
        date: row.snapshotDate,
        amountCents: row.amountCents,
        currency: "USD" as const,
        pricedCopies: row.pricedCopies,
        totalCopies: row.totalCopies,
        recordedAt: row.recordedAt,
      }));
  }

  return {
    sqlitePath: options.sqlitePath,
    close() {
      sqlite.close();
    },
    createSession,
    getSessionByToken,
    getPokecollectorUserMapping,
    savePokecollectorUserMapping,
    listInvitedUsers,
    getPreferences,
    setPreferences,
    inventoryItemWithLiveGuidance(item, preferences) {
      return overlayLiveMaxBuy(item, preferences ?? getPreferences(item.userId));
    },
    getScan,
    listScans,
    saveScan,
    saveScanImage,
    readStoredScanImage,
    getScanImage,
    saveGradeImage,
    getGradeImage,
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
  };
}
