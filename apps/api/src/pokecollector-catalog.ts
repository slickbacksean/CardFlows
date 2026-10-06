import {
  CatalogProviderError,
  MVP_TCGDEX_LANGUAGE,
  POKECOLLECTOR_CARDS_PATH,
  POKECOLLECTOR_CARD_SEARCH_PATH,
  POKECOLLECTOR_SETS_PATH,
  POKECOLLECTOR_UNAVAILABLE_MESSAGE,
  stripCatalogPricing,
  type CardCatalogProvider,
  type CatalogLookupRequest,
  type TcgdexCard,
  type TcgdexCategory,
  type TcgdexLanguage,
  type TcgdexSetBrief,
  type TcgdexVariants,
} from "@cardflow/shared";
import {
  englishPokecollectorCardId,
  tcgdexIdFromPokecollectorCardId,
} from "./pokecollector-accounts";
import {
  createPokecollectorFetcher,
  readPokecollectorJson,
  throwForPokecollectorStatus,
  type PokecollectorHttpOptions,
} from "./pokecollector-http";

const LIST_PAGE_SIZE = 20;
const EMPTY_CARD_COUNT = { total: 0, official: 0 };
const TCGDEX_ASSETS_HOST = "assets.tcgdex.net";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEn(language: TcgdexLanguage): boolean {
  return language === MVP_TCGDEX_LANGUAGE;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asCategory(value: unknown): TcgdexCategory {
  const raw = asString(value)?.toLowerCase() ?? "";
  if (raw === "energy") return "Energy";
  if (raw === "trainer") return "Trainer";
  return "Pokemon";
}

function asVariants(value: Record<string, unknown>): TcgdexVariants {
  return {
    firstEdition: asBoolean(value.variants_first_edition),
    holo: asBoolean(value.variants_holo),
    normal: value.variants_normal !== false,
    reverse: asBoolean(value.variants_reverse),
    wPromo: false,
  };
}

function recordsFromUnknown(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) return [];
  for (const key of ["items", "results", "cards", "sets", "data"]) {
    if (Array.isArray(value[key])) return value[key].filter(isRecord);
  }
  return [value];
}

function tcgdexIdFromWire(value: Record<string, unknown>): string | null {
  const explicit = asString(value.tcg_card_id);
  if (explicit) return explicit;
  const rawId = asString(value.id);
  return rawId ? tcgdexIdFromPokecollectorCardId(rawId) : null;
}

function setIdFromWire(value: Record<string, unknown>): string | null {
  const nested = isRecord(value.set_ref) ? value.set_ref : null;
  return asString(value.set_id) ?? (nested ? asString(nested.tcg_set_id) : null);
}

function isTcgdexAssetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === TCGDEX_ASSETS_HOST;
  } catch {
    return false;
  }
}

function tcgdexImageBaseUrl(value: string): string | null {
  if (!isTcgdexAssetUrl(value)) return null;
  return value.replace(/\/(?:high|low)\.(?:webp|png)$/i, "").replace(/\/+$/, "");
}

function constructedImageBaseUrl(card: Record<string, unknown>): string | null {
  for (const key of ["images_large", "images_small", "image", "custom_image_url"]) {
    const candidate = asString(card[key]);
    if (!candidate) continue;
    const fromWire = tcgdexImageBaseUrl(candidate);
    if (fromWire) return fromWire;
  }
  const nested = isRecord(card.set_ref) ? card.set_ref : null;
  const series = nested ? asString(nested.series) : null;
  const setId = setIdFromWire(card);
  const localId = asString(card.number);
  if (series && setId && localId) {
    return `https://${TCGDEX_ASSETS_HOST}/en/${series}/${setId}/${localId}`;
  }
  return null;
}

function setBriefFromWire(value: unknown, fallbackId: string): TcgdexSetBrief {
  if (!isRecord(value)) {
    return { id: fallbackId, name: fallbackId, cardCount: { ...EMPTY_CARD_COUNT } };
  }
  const id = asString(value.tcg_set_id) ?? (asString(value.id)?.replace(/_en$/i, "") || fallbackId);
  const logo = asString(value.images_logo) ?? asString(value.logo);
  return stripCatalogPricing({
    id,
    name: asString(value.name) ?? id,
    logo: logo && isTcgdexAssetUrl(logo) ? logo : undefined,
    cardCount: {
      total: typeof value.total === "number" ? value.total : 0,
      official: typeof value.printed_total === "number" ? value.printed_total : 0,
    },
  });
}

export function tcgdexCardFromPokecollectorWire(value: unknown): TcgdexCard | null {
  if (!isRecord(value)) return null;
  const id = tcgdexIdFromWire(value);
  const localId = asString(value.number) ?? asString(value.localId);
  const name = asString(value.name);
  if (!id || !localId || !name) return null;
  const nestedSet = isRecord(value.set_ref) ? value.set_ref : value.set;
  const set = setBriefFromWire(nestedSet, setIdFromWire(value) ?? id.split("-")[0] ?? id);
  return stripCatalogPricing({
    id,
    localId,
    name,
    image: constructedImageBaseUrl(value),
    category: asCategory(value.supertype ?? value.category),
    illustrator: asString(value.artist) ?? asString(value.illustrator),
    rarity: asString(value.rarity),
    set,
    variants: asVariants(value),
    language: MVP_TCGDEX_LANGUAGE,
  });
}

function setBriefFromPokecollectorWire(value: unknown): TcgdexSetBrief | null {
  if (!isRecord(value)) return null;
  const lang = asString(value.lang) ?? "en";
  if (lang !== "en") return null;
  const id = asString(value.tcg_set_id) ?? asString(value.id)?.replace(/_en$/i, "") ?? null;
  const name = asString(value.name);
  if (!id || !name) return null;
  return setBriefFromWire(value, id);
}

async function sdkCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CatalogProviderError) throw error;
    throw new CatalogProviderError({
      code: "PROVIDER_UNAVAILABLE",
      message: POKECOLLECTOR_UNAVAILABLE_MESSAGE,
      retryable: true,
    });
  }
}

/**
 * Server-only PokéCollector catalog. English GET, constructed TCGdex art,
 * vendor `pricing` / `price_*` fields stripped from the CardFlow DTO.
 */
export function createPokecollectorCatalogProvider(
  options: PokecollectorHttpOptions,
): CardCatalogProvider {
  const http = createPokecollectorFetcher(options);

  async function getCardById(id: string, language: TcgdexLanguage): Promise<TcgdexCard | null> {
    if (!isEn(language) || !id.trim()) return null;
    const tcgdexId = id.trim();
    const response = await sdkCall(() =>
      http.request(`${POKECOLLECTOR_CARDS_PATH}/${encodeURIComponent(englishPokecollectorCardId(tcgdexId))}`),
    );
    throwForPokecollectorStatus(response);
    if (response.status === 404) return null;
    const card = tcgdexCardFromPokecollectorWire(await readPokecollectorJson(response));
    if (!card || card.set.name !== card.set.id) return card;
    return withResolvedSetName(card);
  }

  async function withResolvedSetName(card: TcgdexCard): Promise<TcgdexCard> {
    try {
      const named = (await englishSetList()).find((set) => set.id === card.set.id);
      if (!named || named.name === card.set.name) return card;
      return { ...card, set: { ...card.set, name: named.name } };
    } catch {
      return card;
    }
  }

  async function searchCards(params: URLSearchParams): Promise<TcgdexCard[]> {
    params.set("lang", MVP_TCGDEX_LANGUAGE);
    if (!params.has("page_size")) params.set("page_size", String(LIST_PAGE_SIZE));
    const response = await sdkCall(() =>
      http.request(`${POKECOLLECTOR_CARD_SEARCH_PATH}?${params.toString()}`),
    );
    throwForPokecollectorStatus(response);
    if (response.status === 404) return [];
    const rows = recordsFromUnknown(await readPokecollectorJson(response));
    const cards: TcgdexCard[] = [];
    for (const row of rows) {
      const card = tcgdexCardFromPokecollectorWire(row);
      if (card) cards.push(card);
    }
    return cards;
  }

  async function getCardBySetAndLocalId(
    setId: string,
    localId: string,
    language: TcgdexLanguage,
  ): Promise<TcgdexCard | null> {
    if (!isEn(language) || !setId.trim() || localId === undefined || localId === null) {
      return null;
    }
    const params = new URLSearchParams({
      set_id: setId.trim(),
      number: String(localId),
    });
    const cards = await searchCards(params);
    return cards.find((card) => card.set.id === setId.trim() && card.localId === String(localId)) ?? cards[0] ?? null;
  }

  let englishSets: Promise<TcgdexSetBrief[]> | null = null;

  function englishSetList(): Promise<TcgdexSetBrief[]> {
    englishSets ??= listSets("en").catch((error: unknown) => {
      englishSets = null;
      throw error;
    });
    return englishSets;
  }

  async function listSets(language: TcgdexLanguage): Promise<TcgdexSetBrief[]> {
    if (!isEn(language)) return [];
    const response = await sdkCall(() => http.request(POKECOLLECTOR_SETS_PATH));
    throwForPokecollectorStatus(response);
    if (response.status === 404) return [];
    const sets: TcgdexSetBrief[] = [];
    for (const row of recordsFromUnknown(await readPokecollectorJson(response))) {
      const set = setBriefFromPokecollectorWire(row);
      if (set) sets.push(set);
    }
    return sets;
  }

  async function resolveSetByName(name: string, language: TcgdexLanguage): Promise<TcgdexSetBrief[]> {
    if (!isEn(language) || !name.trim()) return [];
    const needle = name.trim().toLowerCase();
    const sets = await listSets(language);
    return sets.filter((set) => set.name.trim().toLowerCase() === needle);
  }

  return {
    name: "pokecollector",
    async getCardById(id, language) {
      return getCardById(id, language);
    },
    async getCardBySetAndLocalId(setId, localId, language) {
      return getCardBySetAndLocalId(setId, localId, language);
    },
    resolveSetByName,
    listSets,
    async listCards(req: CatalogLookupRequest) {
      if (!isEn(req.language)) return [];
      if (req.tcgdexId) {
        const card = await getCardById(req.tcgdexId, req.language);
        return card ? [card] : [];
      }
      if (req.setId && req.localId) {
        const card = await getCardBySetAndLocalId(req.setId, req.localId, req.language);
        return card ? [card] : [];
      }
      if (req.setName && req.localId) {
        const sets = await resolveSetByName(req.setName, req.language);
        const cards: TcgdexCard[] = [];
        for (const set of sets) {
          const card = await getCardBySetAndLocalId(set.id, req.localId, req.language);
          if (card) cards.push(card);
        }
        return cards;
      }
      if (!req.name && !req.setId && !req.setName && !req.localId) return [];
      const params = new URLSearchParams();
      if (req.name) params.set("q", req.name);
      if (req.setId) params.set("set_id", req.setId);
      if (req.localId) params.set("number", req.localId);
      return searchCards(params);
    },
  };
}
