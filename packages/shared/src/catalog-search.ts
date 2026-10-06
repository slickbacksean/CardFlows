import {
  CATALOG_CACHED_STALE_MESSAGE,
  CATALOG_FEATURE_DISABLED_MESSAGE,
  CATALOG_NAME_ONLY_NOTICE,
  CATALOG_SEARCH_MANUALLY_MESSAGE,
} from "./catalog-flags";
import {
  CatalogProviderError,
  MVP_TCGDEX_LANGUAGE,
  canonicalCardFromTcgdex,
  type CardCatalogProvider,
  type TcgdexCard,
} from "./catalog";
import type { CardFlowCanonicalCard, CatalogError } from "./types";

export interface CatalogSearchQuery {
  set?: string | null;
  number?: string | null;
  name?: string | null;
  language?: string | null;
}

export interface CachedCatalogQuery {
  language?: string;
  tcgdexId?: string | null;
  setId?: string | null;
  setName?: string | null;
  localId?: string | null;
  name?: string | null;
}

export interface ParsedCatalogSearchQuery {
  set: string | null;
  number: string | null;
  name: string | null;
  language: typeof MVP_TCGDEX_LANGUAGE;
}

export interface CatalogSearchResult {
  provider: "tcgdex" | "mock" | "pokecollector";
  language: typeof MVP_TCGDEX_LANGUAGE;
  query: { set: string | null; number: string | null; name: string | null };
  userConfirmationRequired: true;
  autoConfirm: false;
  nameOnly: boolean;
  cards: CardFlowCanonicalCard[];
  cached: boolean;
  notice: string | null;
  error: CatalogError | null;
}

export class CatalogSearchRequestError extends Error {
  readonly status = 400 as const;

  constructor(message: string) {
    super(message);
    this.name = "CatalogSearchRequestError";
  }
}

function trimQuery(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next ? next : null;
}

function namesEqual(left: string, right: string): boolean {
  return (
    left
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "") ===
    right
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "")
  );
}

function asSearchCard(card: CardFlowCanonicalCard): CardFlowCanonicalCard {
  return {
    ...card,
    cardflowCardId: null,
    mintedOn: undefined,
  };
}

export function parseCatalogSearchQuery(query: CatalogSearchQuery): ParsedCatalogSearchQuery {
  const language = trimQuery(query.language) ?? MVP_TCGDEX_LANGUAGE;
  if (language.toLowerCase() !== MVP_TCGDEX_LANGUAGE) {
    throw new CatalogSearchRequestError("English set and number search only.");
  }
  const set = trimQuery(query.set);
  const number = trimQuery(query.number);
  const name = trimQuery(query.name);
  if (!set && !number && !name) {
    throw new CatalogSearchRequestError("Search by English set and number.");
  }
  return { set, number, name, language: MVP_TCGDEX_LANGUAGE };
}

export function cachedCatalogCardMatches(
  card: CardFlowCanonicalCard,
  query: CachedCatalogQuery,
): boolean {
  const hasKey = Boolean(query.tcgdexId || query.setId || query.setName || query.localId || query.name);
  if (!hasKey) return false;
  const language = query.language ?? MVP_TCGDEX_LANGUAGE;
  if (card.language !== language) return false;
  if (query.tcgdexId && card.tcgdexId !== query.tcgdexId) return false;
  if (query.localId && card.localId !== String(query.localId)) return false;
  if (query.setId && card.tcgdexSetId !== query.setId && card.set.id !== query.setId) {
    return false;
  }
  if (query.setName) {
    const needle = query.setName.trim().toLowerCase();
    const setMatch =
      card.set.name.toLowerCase() === needle ||
      card.tcgdexSetId.toLowerCase() === needle ||
      card.set.id.toLowerCase() === needle;
    if (!setMatch) return false;
  }
  if (query.name && !namesEqual(card.name, query.name)) return false;
  return true;
}

function looksLikeSetId(value: string): boolean {
  return /^[a-z0-9-]+$/i.test(value) && !/\s/.test(value);
}

function cachedQueryFromSearch(query: ParsedCatalogSearchQuery): CachedCatalogQuery {
  return {
    language: query.language,
    setName: query.set,
    localId: query.number,
    name: query.name,
  };
}

async function lookupCatalogCards(
  catalog: CardCatalogProvider,
  query: ParsedCatalogSearchQuery,
): Promise<TcgdexCard[]> {
  if (query.set && query.number) {
    const bySetId = await catalog.getCardBySetAndLocalId(query.set, query.number, query.language);
    if (bySetId) return [bySetId];
    const bySetName = await catalog.listCards({
      language: query.language,
      setName: query.set,
      localId: query.number,
    });
    if (bySetName.length > 0) return bySetName;
    return catalog.listCards({
      language: query.language,
      setId: query.set,
      localId: query.number,
    });
  }

  return catalog.listCards({
    language: query.language,
    setName: query.set && !looksLikeSetId(query.set) ? query.set : null,
    setId: query.set && looksLikeSetId(query.set) ? query.set : null,
    localId: query.number,
    name: query.name,
  });
}

function asCatalogError(error: unknown): CatalogError {
  if (error instanceof CatalogProviderError) return error.toCatalogError();
  return {
    code: "PROVIDER_UNAVAILABLE",
    message: CATALOG_SEARCH_MANUALLY_MESSAGE,
    retryable: true,
  };
}

export async function searchCatalog(
  catalog: CardCatalogProvider,
  rawQuery: CatalogSearchQuery,
  options: { cachedCards?: CardFlowCanonicalCard[] } = {},
): Promise<CatalogSearchResult> {
  const query = parseCatalogSearchQuery(rawQuery);
  const nameOnly = Boolean(query.name) && !query.set && !query.number;
  const cachedCards = options.cachedCards ?? [];

  const base = {
    provider: catalog.name,
    language: query.language,
    query: { set: query.set, number: query.number, name: query.name },
    userConfirmationRequired: true as const,
    autoConfirm: false as const,
    nameOnly,
  };

  try {
    if (catalog.featureDisabled) {
      throw new CatalogProviderError({
        code: "FEATURE_DISABLED",
        message: CATALOG_FEATURE_DISABLED_MESSAGE,
        retryable: false,
      });
    }
    const cards = await lookupCatalogCards(catalog, query);
    return {
      ...base,
      cards: cards.map((card) => asSearchCard(canonicalCardFromTcgdex(card))),
      cached: false,
      notice: nameOnly ? CATALOG_NAME_ONLY_NOTICE : null,
      error: null,
    };
  } catch (error) {
    if (error instanceof CatalogSearchRequestError) throw error;
    const catalogError = asCatalogError(error);
    const cached = cachedCards.filter((card) =>
      cachedCatalogCardMatches(card, cachedQueryFromSearch(query)),
    );
    return {
      ...base,
      cards: cached.map(asSearchCard),
      cached: cached.length > 0,
      notice: cached.length > 0 ? CATALOG_CACHED_STALE_MESSAGE : null,
      error: catalogError,
    };
  }
}
