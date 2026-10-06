import canonicalExample from "../fixtures/cardflow-canonical-card-example.json" with { type: "json" };
import tcgdexAmbiguous from "../fixtures/tcgdex-ambiguous-match-example.json" with { type: "json" };
import tcgdexCardExample from "../fixtures/tcgdex-card-example.json" with { type: "json" };
import tcgdexNoMatch from "../fixtures/tcgdex-no-match-example.json" with { type: "json" };
import {
  MOCK_CARDS,
  MOCK_SETS,
  catalogFingerprint,
  type MockCatalogCard,
  type MockCatalogSet,
} from "./mock-catalog";
import {
  CATALOG_FEATURE_DISABLED_MESSAGE,
  catalogFeatureDisabledError,
} from "./catalog-flags";
import type { CardFlowCanonicalCard, CatalogError, CatalogImage, TcgdexVariants } from "./types";

/** TCGdex language path codes. MVP lookups use `en` only. */
export type TcgdexLanguage =
  | "en"
  | "fr"
  | "es"
  | "it"
  | "pt"
  | "pt-br"
  | "pt-pt"
  | "de"
  | "nl"
  | "pl"
  | "ru"
  | "ja"
  | "ko"
  | "zh-tw"
  | "id"
  | "th"
  | "zh-cn";

export type TcgdexCategory = "Pokemon" | "Energy" | "Trainer";

export const MVP_TCGDEX_LANGUAGE = "en" as const satisfies TcgdexLanguage;

export interface TcgdexSetBrief {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  cardCount: {
    total: number;
    official: number;
  };
}

/** Catalog card after adapter strip. No pricing. */
export interface TcgdexCard {
  id: string;
  localId: string;
  name: string;
  image: string | null;
  category: TcgdexCategory;
  illustrator: string | null;
  rarity: string | null;
  set: TcgdexSetBrief;
  variants: TcgdexVariants;
  language: TcgdexLanguage;
}

export interface CatalogLookupRequest {
  language: TcgdexLanguage;
  tcgdexId?: string | null;
  setId?: string | null;
  setName?: string | null;
  localId?: string | null;
  name?: string | null;
  variantHint?: string | null;
}

export type CatalogErrorCode =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "FEATURE_DISABLED"
  | "UNKNOWN";

export class CatalogProviderError extends Error {
  readonly code: CatalogErrorCode;
  readonly retryable: boolean;
  readonly httpStatus?: number;

  constructor(error: {
    code: CatalogErrorCode;
    message: string;
    retryable: boolean;
    httpStatus?: number;
  }) {
    super(error.message);
    this.name = "CatalogProviderError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.httpStatus = error.httpStatus;
  }

  toCatalogError(): CatalogError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

export type CatalogProviderName = "tcgdex" | "mock" | "pokecollector";

export interface CardCatalogProvider {
  readonly name: CatalogProviderName;
  readonly featureDisabled?: boolean;
  getCardById(id: string, language: TcgdexLanguage): Promise<TcgdexCard | null>;
  getCardBySetAndLocalId(
    setId: string,
    localId: string,
    language: TcgdexLanguage,
  ): Promise<TcgdexCard | null>;
  resolveSetByName(name: string, language: TcgdexLanguage): Promise<TcgdexSetBrief[]>;
  /** English sets, including printed set size. Used to resolve `078/084` on a still. */
  listSets?(language: TcgdexLanguage): Promise<TcgdexSetBrief[]>;
  listCards(req: CatalogLookupRequest): Promise<TcgdexCard[]>;
}

const EMPTY_CARD_COUNT = { total: 0, official: 0 };
const DEFAULT_VARIANTS: TcgdexVariants = {
  firstEdition: false,
  holo: false,
  normal: true,
  reverse: false,
  wPromo: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Drop TCGdex `pricing` at any depth, including `variants_detailed` pricing.
 * Never invent catalog fields while stripping.
 */
export function stripCatalogPricing<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripCatalogPricing(item)) as T;
  }
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "pricing") continue;
    next[key] = stripCatalogPricing(nested);
  }
  return next as T;
}

/** @deprecated Use stripCatalogPricing — kept as the existing export name. */
export function stripPricing<T extends object>(record: T): T {
  return stripCatalogPricing(record);
}

function isEn(language: TcgdexLanguage): boolean {
  return language === MVP_TCGDEX_LANGUAGE;
}

function normalizeLookup(value: string): string {
  return value.trim().toLowerCase();
}

function namesEqual(left: string, right: string): boolean {
  return left
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "") ===
    right
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "");
}

function asCategory(value: unknown): TcgdexCategory {
  if (value === "Energy" || value === "Trainer" || value === "Pokemon") return value;
  return "Pokemon";
}

function asVariants(value: unknown): TcgdexVariants {
  if (!isRecord(value)) return { ...DEFAULT_VARIANTS };
  return {
    firstEdition: Boolean(value.firstEdition),
    holo: Boolean(value.holo),
    normal: value.normal !== false,
    reverse: Boolean(value.reverse),
    wPromo: Boolean(value.wPromo),
  };
}

function asCardCount(value: unknown): TcgdexSetBrief["cardCount"] {
  if (!isRecord(value)) return { ...EMPTY_CARD_COUNT };
  return {
    total: typeof value.total === "number" ? value.total : 0,
    official: typeof value.official === "number" ? value.official : 0,
  };
}

function setBriefFromMock(set: MockCatalogSet): TcgdexSetBrief {
  return {
    id: set.id,
    name: set.name,
    logo: set.logo,
    cardCount: set.cardCount
      ? { total: set.cardCount.total, official: set.cardCount.official }
      : { ...EMPTY_CARD_COUNT },
  };
}

function setBriefFromUnknown(value: unknown, fallbackId: string): TcgdexSetBrief {
  if (!isRecord(value)) {
    return { id: fallbackId, name: fallbackId, cardCount: { ...EMPTY_CARD_COUNT } };
  }
  const id = typeof value.id === "string" && value.id ? value.id : fallbackId;
  return {
    id,
    name: typeof value.name === "string" && value.name ? value.name : id,
    logo: typeof value.logo === "string" ? value.logo : undefined,
    symbol: typeof value.symbol === "string" ? value.symbol : undefined,
    cardCount: asCardCount(value.cardCount),
  };
}

function imageBaseUrl(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (isRecord(value) && typeof value.baseUrl === "string" && value.baseUrl) {
    return value.baseUrl;
  }
  return null;
}

function tcgdexCardFromMock(card: MockCatalogCard): TcgdexCard {
  const set = MOCK_SETS.find((item) => item.id === card.tcgdexSetId);
  return {
    id: card.tcgdexId,
    localId: card.localId,
    name: card.name,
    image: card.image.baseUrl,
    category: asCategory(card.category),
    illustrator: card.illustrator ?? null,
    rarity: card.rarity,
    set: set
      ? setBriefFromMock(set)
      : { id: card.tcgdexSetId, name: card.tcgdexSetId, cardCount: { ...EMPTY_CARD_COUNT } },
    variants: card.variants,
    language: MVP_TCGDEX_LANGUAGE,
  };
}

function asPlainJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

export function tcgdexSetBriefFromWire(value: unknown): TcgdexSetBrief | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id) return null;
  if (typeof value.name !== "string" || !value.name) return null;
  return stripCatalogPricing({
    id: value.id,
    name: value.name,
    logo: typeof value.logo === "string" ? value.logo : undefined,
    symbol: typeof value.symbol === "string" ? value.symbol : undefined,
    cardCount: asCardCount(value.cardCount),
  });
}

/** Map a TCGdex wire card to the stripped DTO. Never invents an id. */
export function tcgdexCardFromWire(value: unknown): TcgdexCard | null {
  return parseWireTcgdexCard(asPlainJson(stripCatalogPricing(value)));
}

function parseWireTcgdexCard(value: unknown): TcgdexCard | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id) return null;
  if (typeof value.localId !== "string" || !value.localId) return null;
  if (typeof value.name !== "string" || !value.name) return null;
  const set = setBriefFromUnknown(value.set, value.id.split("-")[0] ?? value.id);
  return stripCatalogPricing({
    id: value.id,
    localId: value.localId,
    name: value.name,
    image: imageBaseUrl(value.image),
    category: asCategory(value.category),
    illustrator: typeof value.illustrator === "string" ? value.illustrator : null,
    rarity: typeof value.rarity === "string" ? value.rarity : null,
    set,
    variants: asVariants(value.variants),
    language: MVP_TCGDEX_LANGUAGE,
  });
}

function parseCanonicalAsTcgdex(value: unknown): TcgdexCard | null {
  if (!isRecord(value)) return null;
  const id = typeof value.tcgdexId === "string" ? value.tcgdexId : null;
  const localId = typeof value.localId === "string" ? value.localId : null;
  const name = typeof value.name === "string" ? value.name : null;
  if (!id || !localId || !name) return null;
  const setId =
    typeof value.tcgdexSetId === "string" && value.tcgdexSetId
      ? value.tcgdexSetId
      : id.split("-")[0] ?? id;
  return stripCatalogPricing({
    id,
    localId,
    name,
    image: imageBaseUrl(value.image),
    category: asCategory(value.category),
    illustrator: typeof value.illustrator === "string" ? value.illustrator : null,
    rarity: typeof value.rarity === "string" ? value.rarity : null,
    set: setBriefFromUnknown(value.set, setId),
    variants: asVariants(value.variants),
    language: MVP_TCGDEX_LANGUAGE,
  });
}

function cardsFromFixture(raw: unknown): TcgdexCard[] {
  const stripped = stripCatalogPricing(raw);
  if (!isRecord(stripped)) return [];
  const cards: TcgdexCard[] = [];
  const fromCard = parseWireTcgdexCard(stripped.card);
  if (fromCard) cards.push(fromCard);
  const fromCanonical = parseCanonicalAsTcgdex(stripped.canonicalCard);
  if (fromCanonical) cards.push(fromCanonical);
  if (Array.isArray(stripped.candidates)) {
    for (const candidate of stripped.candidates) {
      const parsed = parseCanonicalAsTcgdex(candidate);
      if (parsed) cards.push(parsed);
    }
  }
  return cards;
}

function constructedCatalogImage(card: TcgdexCard, quality: "high" | "low" = "high"): CatalogImage {
  const baseUrl = card.image ?? "";
  return {
    baseUrl,
    source: "tcgdex_assets",
    quality,
    extension: "webp",
    constructedUrl: baseUrl ? `${baseUrl}/${quality}.webp` : "",
    provenance: `tcgdex assets.tcgdex.net; card id ${card.id}; lang ${card.language}; database not affiliated with Nintendo or The Pokémon Company`,
  };
}

export function canonicalCardFromTcgdex(
  card: TcgdexCard,
  options: {
    cardflowCardId?: string | null;
    cardsightCardId?: string | null;
    selectedVariant?: string | null;
    imageQuality?: "high" | "low";
  } = {},
): CardFlowCanonicalCard {
  const stripped = stripCatalogPricing(card);
  return {
    cardflowCardId: options.cardflowCardId ?? null,
    language: stripped.language,
    tcgdexId: stripped.id,
    tcgdexSetId: stripped.set.id,
    localId: stripped.localId,
    name: stripped.name,
    category: stripped.category,
    rarity: stripped.rarity,
    illustrator: stripped.illustrator,
    variants: stripped.variants,
    selectedVariant: options.selectedVariant ?? null,
    set: {
      id: stripped.set.id,
      name: stripped.set.name,
      logo: stripped.set.logo,
      cardCount: stripped.set.cardCount,
    },
    image: constructedCatalogImage(stripped, options.imageQuality),
    cardsightCardId: options.cardsightCardId ?? null,
    catalogFingerprint: catalogFingerprint(stripped.language, stripped.id),
  };
}

interface MockCatalogIndex {
  cards: TcgdexCard[];
  sets: TcgdexSetBrief[];
  aliasesBySetId: Map<string, string[]>;
}

function indexMockCatalog(): MockCatalogIndex {
  const cardsById = new Map<string, TcgdexCard>();
  const setsById = new Map<string, TcgdexSetBrief>();
  const aliasesBySetId = new Map<string, string[]>();

  for (const set of MOCK_SETS) {
    setsById.set(set.id, setBriefFromMock(set));
    aliasesBySetId.set(set.id, [set.name, ...set.aliases]);
  }

  for (const card of MOCK_CARDS) {
    const next = stripCatalogPricing(tcgdexCardFromMock(card));
    cardsById.set(next.id, next);
    if (!setsById.has(next.set.id)) setsById.set(next.set.id, next.set);
  }

  const fixtures = [tcgdexCardExample, tcgdexAmbiguous, tcgdexNoMatch, canonicalExample];
  for (const fixture of fixtures) {
    for (const card of cardsFromFixture(fixture)) {
      if (!cardsById.has(card.id)) cardsById.set(card.id, card);
      if (!setsById.has(card.set.id)) setsById.set(card.set.id, card.set);
    }
  }

  return {
    cards: [...cardsById.values()].map((card) => stripCatalogPricing(card)),
    sets: [...setsById.values()],
    aliasesBySetId,
  };
}

export function createMockTcgdexCatalogProvider(): CardCatalogProvider {
  const index = indexMockCatalog();

  function requireEn(language: TcgdexLanguage): boolean {
    return isEn(language);
  }

  async function resolveSetByName(name: string, language: TcgdexLanguage): Promise<TcgdexSetBrief[]> {
    if (!requireEn(language) || !name.trim()) return [];
    const needle = normalizeLookup(name);
    return index.sets.filter((set) => {
      if (normalizeLookup(set.name) === needle) return true;
      const aliases = index.aliasesBySetId.get(set.id) ?? [];
      return aliases.some((alias) => normalizeLookup(alias) === needle);
    });
  }

  return {
    name: "mock",
    async getCardById(id, language) {
      if (!requireEn(language) || !id) return null;
      const card = index.cards.find((item) => item.id === id) ?? null;
      return card ? stripCatalogPricing(card) : null;
    },
    async getCardBySetAndLocalId(setId, localId, language) {
      if (!requireEn(language) || !setId || localId === undefined || localId === null) {
        return null;
      }
      const needle = String(localId);
      const card =
        index.cards.find((item) => item.set.id === setId && item.localId === needle) ?? null;
      return card ? stripCatalogPricing(card) : null;
    },
    resolveSetByName,
    async listSets(language) {
      if (!requireEn(language)) return [];
      return index.sets;
    },
    async listCards(req) {
      if (!requireEn(req.language)) return [];
      let results = index.cards;
      if (req.tcgdexId) {
        results = results.filter((card) => card.id === req.tcgdexId);
      }
      if (req.setId) {
        results = results.filter((card) => card.set.id === req.setId);
      }
      if (req.localId) {
        const localId = String(req.localId);
        results = results.filter((card) => card.localId === localId);
      }
      if (req.setName) {
        const sets = await resolveSetByName(req.setName, req.language);
        const allowed = new Set(sets.map((set) => set.id));
        results = results.filter((card) => allowed.has(card.set.id));
      }
      if (req.name) {
        results = results.filter((card) => namesEqual(card.name, req.name as string));
      }
      return results.map((card) => stripCatalogPricing(card));
    },
  };
}

export const mockTcgdexCatalogProvider = createMockTcgdexCatalogProvider();

function disabledLookup(): never {
  throw new CatalogProviderError({
    code: "FEATURE_DISABLED",
    message: CATALOG_FEATURE_DISABLED_MESSAGE,
    retryable: false,
  });
}

/** Kill-switch adapter: mapping returns FEATURE_DISABLED + search manually. */
export function createDisabledTcgdexCatalogProvider(): CardCatalogProvider {
  return {
    name: "tcgdex",
    featureDisabled: true,
    getCardById: disabledLookup,
    getCardBySetAndLocalId: disabledLookup,
    resolveSetByName: disabledLookup,
    listCards: disabledLookup,
  };
}

export { catalogFeatureDisabledError };
