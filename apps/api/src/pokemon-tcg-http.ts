/**
 * pokemontcg.io v2 client for the daily price snapshot.
 * Never logs POKEMONTCG_API_KEY. Optional key raises the daily cap from 1,000 to 20,000.
 */

export const POKEMONTCG_API_BASE = "https://api.pokemontcg.io/v2";
export const POKEMONTCG_PAGE_SIZE = 250;
export const POKEMONTCG_SELECT = "id,name,number,set,tcgplayer,images";
/** With a key: stay well under typical keyed throughput. Without: under 30 req/min. */
export const POKEMONTCG_DELAY_MS_WITH_KEY = 250;
export const POKEMONTCG_DELAY_MS_WITHOUT_KEY = 2100;
export const POKEMONTCG_MAX_RETRIES = 4;

export interface PokemonTcgSetRef {
  id?: string;
  name?: string;
}

export interface PokemonTcgPriceFinish {
  market?: number | null;
  low?: number | null;
  mid?: number | null;
  high?: number | null;
}

export interface PokemonTcgPlayerBlock {
  url?: string;
  updatedAt?: string;
  prices?: Record<string, PokemonTcgPriceFinish | null | undefined>;
}

export interface PokemonTcgCard {
  id: string;
  name?: string;
  number?: string;
  set?: PokemonTcgSetRef;
  images?: { small?: string; large?: string };
  tcgplayer?: PokemonTcgPlayerBlock;
}

export interface PokemonTcgPage {
  data: PokemonTcgCard[];
  page: number;
  pageSize: number;
  count: number;
  totalCount: number;
}

export function pokemonTcgApiKeyFromEnv(env: NodeJS.Dict<string | undefined> = process.env): string | undefined {
  const key = env.POKEMONTCG_API_KEY?.trim();
  return key || undefined;
}

export function pokemonTcgRequestDelayMs(hasApiKey: boolean): number {
  return hasApiKey ? POKEMONTCG_DELAY_MS_WITH_KEY : POKEMONTCG_DELAY_MS_WITHOUT_KEY;
}

export function marketUsdToCents(market: unknown): number | null {
  if (typeof market !== "number" || !Number.isFinite(market) || market < 0) return null;
  return Math.round(market * 100);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseFinish(value: unknown): PokemonTcgPriceFinish | null {
  if (!isRecord(value)) return null;
  const market = typeof value.market === "number" ? value.market : undefined;
  return { market };
}

function parseCard(value: unknown): PokemonTcgCard | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  if (!id) return null;
  const set = isRecord(value.set)
    ? { id: asString(value.set.id), name: asString(value.set.name) }
    : undefined;
  const images = isRecord(value.images)
    ? { small: asString(value.images.small), large: asString(value.images.large) }
    : undefined;
  let tcgplayer: PokemonTcgPlayerBlock | undefined;
  if (isRecord(value.tcgplayer)) {
    const prices: Record<string, PokemonTcgPriceFinish> = {};
    if (isRecord(value.tcgplayer.prices)) {
      for (const [finish, raw] of Object.entries(value.tcgplayer.prices)) {
        const parsed = parseFinish(raw);
        if (parsed) prices[finish] = parsed;
      }
    }
    tcgplayer = {
      url: asString(value.tcgplayer.url),
      updatedAt: asString(value.tcgplayer.updatedAt),
      prices,
    };
  }
  return {
    id,
    name: asString(value.name),
    number: asString(value.number),
    set,
    images,
    tcgplayer,
  };
}

export function parsePokemonTcgPage(value: unknown): PokemonTcgPage {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("pokemontcg.io: unexpected response shape");
  }
  const data = value.data.map(parseCard).filter((card): card is PokemonTcgCard => card != null);
  return {
    data,
    page: typeof value.page === "number" ? value.page : 1,
    pageSize: typeof value.pageSize === "number" ? value.pageSize : data.length,
    count: typeof value.count === "number" ? value.count : data.length,
    totalCount: typeof value.totalCount === "number" ? value.totalCount : data.length,
  };
}

export async function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchPokemonTcgPageOptions {
  page: number;
  pageSize?: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function fetchPokemonTcgPage(options: FetchPokemonTcgPageOptions): Promise<PokemonTcgPage> {
  const pageSize = options.pageSize ?? POKEMONTCG_PAGE_SIZE;
  const url = new URL(`${POKEMONTCG_API_BASE}/cards`);
  url.searchParams.set("page", String(options.page));
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("select", POKEMONTCG_SELECT);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.apiKey) headers["X-Api-Key"] = options.apiKey;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), { headers, signal: controller.signal });
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "");
      const error = new Error("pokemontcg.io rate limited") as Error & { status: number; retryAfterMs: number };
      error.status = 429;
      error.retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5_000;
      throw error;
    }
    if (!response.ok) {
      throw new Error(`pokemontcg.io HTTP ${response.status}`);
    }
    return parsePokemonTcgPage(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPokemonTcgPageWithRetry(
  options: FetchPokemonTcgPageOptions & { sleep?: (ms: number) => Promise<void>; maxRetries?: number },
): Promise<PokemonTcgPage> {
  const sleep = options.sleep ?? sleepMs;
  const maxRetries = options.maxRetries ?? POKEMONTCG_MAX_RETRIES;
  let attempt = 0;
  while (true) {
    try {
      return await fetchPokemonTcgPage(options);
    } catch (error) {
      attempt += 1;
      const retryAfterMs =
        error && typeof error === "object" && "retryAfterMs" in error
          ? Number((error as { retryAfterMs?: number }).retryAfterMs)
          : 0;
      if (attempt > maxRetries) throw error;
      const backoff = retryAfterMs > 0 ? retryAfterMs * attempt : 1000 * 2 ** attempt;
      await sleep(backoff);
    }
  }
}
