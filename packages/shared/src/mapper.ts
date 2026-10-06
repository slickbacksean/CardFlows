import {
  CATALOG_SEARCH_MANUALLY_MESSAGE,
  catalogFeatureDisabledError,
} from "./catalog-flags";
import {
  CatalogProviderError,
  canonicalCardFromTcgdex,
  mockTcgdexCatalogProvider,
  type CardCatalogProvider,
  type TcgdexCard,
} from "./catalog";
import { catalogFingerprint } from "./mock-catalog";
import { CONFIRM_COULD_NOT_CONFIRM_MESSAGE } from "./confirm-copy";
import { normalizeEnglishTcgdexId } from "./obb-phash";
import type {
  CardFlowCanonicalCard,
  CardFlowNormalizedRecognitionResult,
  CatalogMappingResult,
  MappingConfidence,
  MappingStatus,
  RecognitionCandidate,
  RecognitionDetection,
} from "./types";

interface LookupKeys {
  language: string | null;
  name: string | null;
  setName: string | null;
  localId: string | null;
  cardsightCardId: string | null;
}

interface HighMapHit {
  card: TcgdexCard;
  keys: LookupKeys;
  matchedOn: string[];
  nameVerified: boolean;
  resolvedSetId: string;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function namesEqual(left: string, right: string): boolean {
  return normalizeName(left) === normalizeName(right);
}

function tcgdexIdFromRecognition(
  item: RecognitionDetection | RecognitionCandidate,
): string | null {
  const field = item.fields.find((entry) => entry.key.toLowerCase() === "tcgdex_id")?.value;
  return normalizeEnglishTcgdexId(field) ?? normalizeEnglishTcgdexId(item.vendorCardId);
}

function uniqueTcgdexIds(detection: RecognitionDetection): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of [detection, ...detection.candidates]) {
    const id = tcgdexIdFromRecognition(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

async function mapPhashTcgdexIds(
  catalog: CardCatalogProvider,
  detection: RecognitionDetection,
  tcgdexIds: string[],
  language: string | null,
): Promise<CatalogMappingResult> {
  const hits: TcgdexCard[] = [];
  for (const tcgdexId of tcgdexIds) {
    const card = await catalog.getCardById(tcgdexId, "en");
    if (card) hits.push(card);
  }

  const lookupBase = {
    language,
    setName: detection.setName,
    resolvedSetId: hits[0]?.set.id ?? null,
    localId: detection.number,
    method: "catalog GET by tcgdex_id from OBB/pHash",
    nameVerified: hits.length === 1,
    nameOnlySearchForbiddenForAutoMap: true as const,
  };

  if (hits.length === 1 && detection.confidence === "High") {
    const canonical = canonicalCardFromTcgdex(hits[0]!, {
      cardflowCardId: null,
      cardsightCardId: null,
    });
    return mappingResult(catalog, {
      confidence: "High",
      status: "matched",
      matchedOn: ["tcgdex_id"],
      cardflowCardId: null,
      tcgdexId: canonical.tcgdexId,
      cardsightCardId: null,
      canonicalCard: {
        ...canonical,
        mappingConfidence: "High",
        mappingStatus: "matched",
        matchMethod: "identify",
      },
      candidates: [],
      error: null,
      lookup: lookupBase,
      recommendedUx:
        "Pre-select this card on the confirm screen; user must tap Confirm before Purchased or Watchlist",
    });
  }

  if (hits.length >= 1) {
    const candidates = hits.map((card) =>
      canonicalCardFromTcgdex(card, { cardflowCardId: null, cardsightCardId: null }),
    );
    return mappingResult(catalog, {
      confidence: hits.length === 1 ? detection.confidence : "Medium",
      status: "ambiguous",
      matchedOn: ["tcgdex_id"],
      cardflowCardId: null,
      tcgdexId: null,
      cardsightCardId: null,
      canonicalCard: null,
      candidates,
      error: null,
      lookup: { ...lookupBase, nameVerified: false },
      recommendedUx: CONFIRM_COULD_NOT_CONFIRM_MESSAGE,
    });
  }

  return mappingResult(catalog, {
    confidence: "Unresolved",
    status: "no_match",
    matchedOn: [],
    cardflowCardId: null,
    tcgdexId: null,
    cardsightCardId: null,
    canonicalCard: null,
    candidates: [],
    error: null,
    lookup: {
      ...lookupBase,
      resolvedSetId: null,
      method: "OBB/pHash tcgdex_id not in catalog; not invented",
      nameVerified: false,
    },
    recommendedUx: CONFIRM_COULD_NOT_CONFIRM_MESSAGE,
  });
}

function keysFromDetection(
  detection: RecognitionDetection | RecognitionCandidate,
): LookupKeys {
  return {
    language: detection.language,
    name: detection.name,
    setName: detection.setName,
    localId: detection.number,
    cardsightCardId: detection.vendorCardId,
  };
}

function resolveLanguage(language: string | null): "en" | "invalid" | "missing" {
  if (!language) return "missing";
  return language.toLowerCase() === "en" ? "en" : "invalid";
}

function mappingResult(
  catalog: CardCatalogProvider,
  partial: Omit<CatalogMappingResult, "provider" | "ok" | "userConfirmation" | "_meta"> & {
    recommendedUx: string;
  },
): CatalogMappingResult {
  return {
    provider: catalog.name,
    ok: true,
    ...partial,
    userConfirmation: {
      required: true,
      crmWriteAllowedBeforeConfirm: false,
      recommendedUx: partial.recommendedUx,
    },
    _meta: catalog.name === "mock" ? { mocked: true } : undefined,
  };
}

async function tryCompositeMap(
  catalog: CardCatalogProvider,
  keys: LookupKeys,
): Promise<{
  hit?: HighMapHit;
  status?: "no_match" | "provider_conflict" | "unresolved_language";
  resolvedSetId: string | null;
}> {
  const language = resolveLanguage(keys.language);
  if (language === "invalid") {
    return { status: "unresolved_language", resolvedSetId: null };
  }

  if (!keys.setName || !keys.localId || !keys.name) {
    return { resolvedSetId: null };
  }

  const sets = await catalog.resolveSetByName(keys.setName, "en");
  const needle = keys.setName.trim().toLowerCase();
  const set =
    sets.find((item) => item.name.toLowerCase() === needle) ?? sets[0] ?? null;
  if (!set) {
    return { status: "no_match", resolvedSetId: null };
  }

  const card = await catalog.getCardBySetAndLocalId(set.id, keys.localId, "en");
  if (!card) {
    return { status: "no_match", resolvedSetId: set.id };
  }

  const nameVerified = namesEqual(card.name, keys.name);
  if (!nameVerified) {
    return { status: "provider_conflict", resolvedSetId: set.id };
  }

  return {
    hit: {
      card,
      keys,
      matchedOn: ["language", "set", "localId", "name"],
      nameVerified: true,
      resolvedSetId: set.id,
    },
    resolvedSetId: set.id,
  };
}

function candidateFromHit(hit: HighMapHit): CardFlowCanonicalCard {
  return canonicalCardFromTcgdex(hit.card, {
    cardflowCardId: null,
    cardsightCardId: hit.keys.cardsightCardId,
  });
}

function catalogUnavailableResult(
  catalog: CardCatalogProvider,
  error: CatalogMappingResult["error"],
  recommendedUx: string,
): CatalogMappingResult {
  return mappingResult(catalog, {
    confidence: "Unresolved",
    status: "catalog_unavailable",
    matchedOn: [],
    cardflowCardId: null,
    tcgdexId: null,
    cardsightCardId: null,
    canonicalCard: null,
    candidates: [],
    error,
    lookup: {
      language: null,
      setName: null,
      resolvedSetId: null,
      localId: null,
      method: error?.code === "FEATURE_DISABLED" ? "catalog flag off" : "catalog provider error",
      nameVerified: false,
      nameOnlySearchForbiddenForAutoMap: true,
    },
    recommendedUx,
  });
}

export async function mapRecognitionToCatalog(
  recognition: CardFlowNormalizedRecognitionResult,
  catalog: CardCatalogProvider = mockTcgdexCatalogProvider,
): Promise<CatalogMappingResult> {
  if (catalog.featureDisabled) {
    return catalogUnavailableResult(
      catalog,
      catalogFeatureDisabledError(),
      CATALOG_SEARCH_MANUALLY_MESSAGE,
    );
  }

  try {
    return await mapRecognitionToCatalogUnchecked(recognition, catalog);
  } catch (error) {
    if (error instanceof CatalogProviderError) {
      return catalogUnavailableResult(
        catalog,
        error.toCatalogError(),
        CATALOG_SEARCH_MANUALLY_MESSAGE,
      );
    }
    throw error;
  }
}

async function mapRecognitionToCatalogUnchecked(
  recognition: CardFlowNormalizedRecognitionResult,
  catalog: CardCatalogProvider,
): Promise<CatalogMappingResult> {
  const emptyLookup = {
    language: null as string | null,
    setName: null as string | null,
    resolvedSetId: null as string | null,
    localId: null as string | null,
    method: "none",
    nameVerified: false,
    nameOnlySearchForbiddenForAutoMap: true,
  };

  if (!recognition.ok) {
    return mappingResult(catalog, {
      confidence: "Unresolved",
      status: "catalog_unavailable",
      matchedOn: [],
      cardflowCardId: null,
      tcgdexId: null,
      cardsightCardId: null,
      canonicalCard: null,
      candidates: [],
      error: recognition.error
        ? {
            code: recognition.error.code,
            message: recognition.error.message,
            retryable: recognition.error.retryable,
          }
        : {
            code: "RECOGNITION_FAILED",
            message: "Recognition provider failed",
            retryable: true,
          },
      lookup: { ...emptyLookup, method: "recognition error; catalog not queried" },
      recommendedUx:
        recognition.error?.code === "BAD_REQUEST"
          ? CONFIRM_COULD_NOT_CONFIRM_MESSAGE
          : "Retry scan. Do not mint a CardFlow id from a failed identify.",
    });
  }

  const detection = recognition.detections[0];
  if (!detection) {
    return mappingResult(catalog, {
      confidence: "Unresolved",
      status: "no_match",
      matchedOn: [],
      cardflowCardId: null,
      tcgdexId: null,
      cardsightCardId: null,
      canonicalCard: null,
      candidates: [],
      error: null,
      lookup: {
        ...emptyLookup,
        method: "empty detections; no catalog lookup",
      },
      recommendedUx: CONFIRM_COULD_NOT_CONFIRM_MESSAGE,
    });
  }

  const primaryKeys = keysFromDetection(detection);
  const languageState = resolveLanguage(primaryKeys.language);
  const language = languageState === "missing" ? "en" : primaryKeys.language;

  if (languageState === "invalid") {
    return mappingResult(catalog, {
      confidence: "Unresolved",
      status: "no_match",
      matchedOn: [],
      cardflowCardId: null,
      tcgdexId: null,
      cardsightCardId: primaryKeys.cardsightCardId,
      canonicalCard: null,
      candidates: [],
      error: null,
      lookup: {
        language: primaryKeys.language,
        setName: primaryKeys.setName,
        resolvedSetId: null,
        localId: primaryKeys.localId,
        method: "language is not en; auto-map rejected",
        nameVerified: false,
        nameOnlySearchForbiddenForAutoMap: true,
      },
      recommendedUx: "English raw singles only for MVP. Do not auto-map other languages.",
    });
  }

  const rankedTcgdexIds = uniqueTcgdexIds(detection);

  if (rankedTcgdexIds.length > 0) {
    return mapPhashTcgdexIds(catalog, detection, rankedTcgdexIds, language);
  }

  const primaryHasComposite = Boolean(
    primaryKeys.setName && primaryKeys.localId && primaryKeys.name,
  );
  const primaryMap = await tryCompositeMap(catalog, { ...primaryKeys, language });

  if (primaryHasComposite && primaryMap.hit) {
    const canonical = canonicalCardFromTcgdex(primaryMap.hit.card, {
      cardflowCardId: null,
      cardsightCardId: primaryKeys.cardsightCardId,
    });
    return mappingResult(catalog, {
      confidence: "High",
      status: "matched",
      matchedOn: primaryMap.hit.matchedOn,
      cardflowCardId: null,
      tcgdexId: canonical.tcgdexId,
      cardsightCardId: primaryKeys.cardsightCardId,
      canonicalCard: {
        ...canonical,
        mappingConfidence: "High",
        mappingStatus: "matched",
        matchMethod: "identify",
      },
      candidates: [],
      error: null,
      lookup: {
        language,
        setName: primaryKeys.setName,
        resolvedSetId: primaryMap.hit.resolvedSetId,
        localId: primaryKeys.localId,
        method: `${catalog.name} GET /v2/en/sets/${primaryMap.hit.resolvedSetId}/${primaryKeys.localId}`,
        nameVerified: true,
        nameOnlySearchForbiddenForAutoMap: true,
      },
      recommendedUx:
        "Pre-select this card on the confirm screen; user must tap Confirm before Purchased or Watchlist",
    });
  }

  if (primaryHasComposite && primaryMap.status === "provider_conflict") {
    return mappingResult(catalog, {
      confidence: "Unresolved",
      status: "provider_conflict",
      matchedOn: ["language", "set", "localId"],
      cardflowCardId: null,
      tcgdexId: null,
      cardsightCardId: primaryKeys.cardsightCardId,
      canonicalCard: null,
      candidates: [],
      error: null,
      lookup: {
        language,
        setName: primaryKeys.setName,
        resolvedSetId: primaryMap.resolvedSetId,
        localId: primaryKeys.localId,
        method: "set+localId hit; official name disagrees with recognition",
        nameVerified: false,
        nameOnlySearchForbiddenForAutoMap: true,
      },
      recommendedUx:
        "Show recognition fields and catalog fields. User must pick or search. Do not overwrite inventory.",
    });
  }

  if (primaryHasComposite && primaryMap.status === "no_match") {
    return mappingResult(catalog, {
      confidence: "Unresolved",
      status: "no_match",
      matchedOn: [],
      cardflowCardId: null,
      tcgdexId: null,
      cardsightCardId: primaryKeys.cardsightCardId,
      canonicalCard: null,
      candidates: [],
      error: null,
      lookup: {
        language,
        setName: primaryKeys.setName,
        resolvedSetId: primaryMap.resolvedSetId,
        localId: primaryKeys.localId,
        method: primaryMap.resolvedSetId
          ? "set resolved; set+localId miss"
          : "set name eq: failed; no CardFlow alias; set+localId not attempted",
        nameVerified: false,
        nameOnlySearchForbiddenForAutoMap: true,
      },
      recommendedUx: CONFIRM_COULD_NOT_CONFIRM_MESSAGE,
    });
  }

  const nestedHits: HighMapHit[] = [];
  for (const candidate of detection.candidates) {
    const nestedKeys = keysFromDetection(candidate);
    const nestedMap = await tryCompositeMap(catalog, {
      ...nestedKeys,
      language: nestedKeys.language ?? language,
    });
    if (nestedMap.hit) nestedHits.push(nestedMap.hit);
  }

  const uniqueHits = new Map<string, HighMapHit>();
  for (const hit of nestedHits) {
    uniqueHits.set(hit.card.id, hit);
  }

  if (uniqueHits.size > 0) {
    const candidates = [...uniqueHits.values()].map((hit) => ({
      ...candidateFromHit(hit),
      catalogFingerprint: catalogFingerprint("en", hit.card.id),
    }));
    return mappingResult(catalog, {
      confidence: "Medium",
      status: "ambiguous",
      matchedOn: ["language", "name"],
      cardflowCardId: null,
      tcgdexId: null,
      cardsightCardId: primaryKeys.cardsightCardId,
      canonicalCard: null,
      candidates,
      error: null,
      lookup: {
        language,
        setName: primaryKeys.setName,
        resolvedSetId: null,
        localId: primaryKeys.localId,
        method:
          "CardSight suggestions each mapped with language + set + localId + name; primary detection has name only (insufficient to auto-map)",
        nameVerified: false,
        nameOnlySearchForbiddenForAutoMap: true,
      },
      recommendedUx: CONFIRM_COULD_NOT_CONFIRM_MESSAGE,
    });
  }

  const nameOnly = Boolean(primaryKeys.name && !primaryKeys.setName && !primaryKeys.localId);
  const confidence: MappingConfidence = "Unresolved";
  const status: MappingStatus = "no_match";

  return mappingResult(catalog, {
    confidence,
    status,
    matchedOn: nameOnly ? ["language", "name"] : [],
    cardflowCardId: null,
    tcgdexId: null,
    cardsightCardId: primaryKeys.cardsightCardId,
    canonicalCard: null,
    candidates: [],
    error: null,
    lookup: {
      language,
      setName: primaryKeys.setName,
      resolvedSetId: null,
      localId: primaryKeys.localId,
      method: nameOnly
        ? "name-only search forbidden for auto-map"
        : "insufficient keys for composite map",
      nameVerified: false,
      nameOnlySearchForbiddenForAutoMap: true,
    },
    recommendedUx: CONFIRM_COULD_NOT_CONFIRM_MESSAGE,
  });
}
