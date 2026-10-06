import TCGdex, { Query } from "@tcgdex/sdk";
import {
  CATALOG_SEARCH_MANUALLY_MESSAGE,
  CatalogProviderError,
  MVP_TCGDEX_LANGUAGE,
  TCGDEX_CATALOG_CACHE_TTL_SECONDS,
  TCGDEX_CATALOG_MAX_RETRIES,
  TCGDEX_CATALOG_TIMEOUT_MS,
  TCGDEX_PRICING_IGNORED,
  TCGDEX_PUBLIC_ENDPOINT,
  TCGDEX_SELF_HOSTED,
  stripCatalogPricing,
  tcgdexCardFromWire,
  tcgdexSetBriefFromWire,
  type CardCatalogProvider,
  type CatalogLookupRequest,
  type TcgdexCard,
  type TcgdexLanguage,
  type TcgdexSetBrief,
} from "@cardflow/shared";

const LIST_PAGE_SIZE = 20;

export interface TcgdexCatalogAdapterOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  cacheTtlSeconds?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  return name === "AbortError" || name === "TimeoutError";
}

function retryDelayMs(attempt: number): number {
  return 50 * 2 ** attempt;
}

export function createTcgdexFetch(
  options: TcgdexCatalogAdapterOptions = {},
): typeof fetch {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? TCGDEX_CATALOG_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? TCGDEX_CATALOG_MAX_RETRIES;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  return async (input, init) => {
    const attempts = maxRetries + 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(input, {
          ...init,
          signal: controller.signal,
        });
        if (response.status >= 500 && attempt < attempts - 1) {
          await sleep(retryDelayMs(attempt));
          continue;
        }
        return response;
      } catch (error) {
        if (isAbortError(error)) {
          throw new CatalogProviderError({
            code: "PROVIDER_TIMEOUT",
            message: CATALOG_SEARCH_MANUALLY_MESSAGE,
            retryable: true,
          });
        }
        throw new CatalogProviderError({
          code: "PROVIDER_UNAVAILABLE",
          message: CATALOG_SEARCH_MANUALLY_MESSAGE,
          retryable: true,
        });
      } finally {
        clearTimeout(timer);
      }
    }
    throw new CatalogProviderError({
      code: "PROVIDER_UNAVAILABLE",
      message: CATALOG_SEARCH_MANUALLY_MESSAGE,
      retryable: true,
    });
  };
}

function isEn(language: TcgdexLanguage): boolean {
  return language === MVP_TCGDEX_LANGUAGE;
}

function asJsonRecord(value: unknown): unknown {
  return stripCatalogPricing(JSON.parse(JSON.stringify(value ?? null)));
}

function cardFromSdk(value: unknown): TcgdexCard | null {
  if (value == null) return null;
  return tcgdexCardFromWire(asJsonRecord(value));
}

function setsFromSdk(value: unknown): TcgdexSetBrief[] {
  const stripped = asJsonRecord(value);
  const rows = Array.isArray(stripped) ? stripped : stripped ? [stripped] : [];
  const sets: TcgdexSetBrief[] = [];
  for (const row of rows) {
    const set = tcgdexSetBriefFromWire(row);
    if (set) sets.push(set);
  }
  return sets;
}

async function sdkCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CatalogProviderError) throw error;
    throw new CatalogProviderError({
      code: "PROVIDER_UNAVAILABLE",
      message: CATALOG_SEARCH_MANUALLY_MESSAGE,
      retryable: true,
    });
  }
}

/**
 * Server-only TCGdex adapter. Public GET, no API key, pricing stripped.
 * `tcgdex_self_hosted` stays false — public API only.
 */
export function createTcgdexCatalogProvider(
  options: TcgdexCatalogAdapterOptions = {},
): CardCatalogProvider {
  if (TCGDEX_SELF_HOSTED) {
    throw new Error("tcgdex_self_hosted must stay false");
  }
  if (!TCGDEX_PRICING_IGNORED) {
    throw new Error("tcgdex_pricing_ignored must stay true");
  }

  const tcgdex = new TCGdex("en");
  tcgdex.setEndpoint(TCGDEX_PUBLIC_ENDPOINT);
  tcgdex.setCacheTTL(options.cacheTtlSeconds ?? TCGDEX_CATALOG_CACHE_TTL_SECONDS);
  TCGdex.fetch = createTcgdexFetch(options);

  async function getCardById(id: string, language: TcgdexLanguage): Promise<TcgdexCard | null> {
    if (!isEn(language) || !id.trim()) return null;
    const raw = await sdkCall(() => tcgdex.fetch("cards", id.trim()));
    return cardFromSdk(raw);
  }

  async function getCardBySetAndLocalId(
    setId: string,
    localId: string,
    language: TcgdexLanguage,
  ): Promise<TcgdexCard | null> {
    if (!isEn(language) || !setId.trim() || localId === undefined || localId === null) {
      return null;
    }
    const raw = await sdkCall(() => tcgdex.fetch("sets", setId.trim(), String(localId)));
    return cardFromSdk(raw);
  }

  async function listSets(language: TcgdexLanguage): Promise<TcgdexSetBrief[]> {
    if (!isEn(language)) return [];
    const listed = await sdkCall(() => tcgdex.fetch("sets"));
    return setsFromSdk(listed);
  }

  async function resolveSetByName(name: string, language: TcgdexLanguage): Promise<TcgdexSetBrief[]> {
    if (!isEn(language) || !name.trim()) return [];
    const query = Query.create().equal("name", name.trim()).paginate(1, LIST_PAGE_SIZE);
    const listed = await sdkCall(() => tcgdex.fetchWithQuery(["sets"], query.params));
    const fromQuery = setsFromSdk(listed);
    if (fromQuery.length > 0) return fromQuery;
    const byNameOrId = await sdkCall(() => tcgdex.fetch("sets", name.trim()));
    return setsFromSdk(byNameOrId);
  }

  return {
    name: "tcgdex",
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

      const query = Query.create().paginate(1, LIST_PAGE_SIZE);
      if (req.name) query.equal("name", req.name);
      if (req.setId) query.equal("set.id", req.setId);
      const listed = await sdkCall(() => tcgdex.fetchWithQuery(["cards"], query.params));
      const rows = Array.isArray(listed) ? listed : [];
      const cards: TcgdexCard[] = [];
      for (const row of rows) {
        const id = isRecord(row) && typeof row.id === "string" ? row.id : null;
        if (!id) continue;
        const full = await getCardById(id, req.language);
        if (full) cards.push(full);
      }
      return cards;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
