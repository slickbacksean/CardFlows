/**
 * TCGCSV client for the daily Trending snapshot.
 * Polite: custom User-Agent, delay between requests, retries with backoff.
 * Check last-updated.txt before pulling groups/products/prices.
 */
import {
  type TcgcsvGroupRef,
  type TcgcsvPriceRef,
  type TcgcsvProductRef,
} from "@cardflow/shared";

export const TCGCSV_API_BASE = "https://tcgcsv.com";
export const TCGCSV_POKEMON_CATEGORY_ID = 3;
export const TCGCSV_DELAY_MS = 150;
export const TCGCSV_MAX_RETRIES = 4;
export const TCGCSV_DEFAULT_USER_AGENT = "PokeSniper/1.0 (trending-snapshot)";
export const TCGCSV_TIMEOUT_MS = 30_000;

export function tcgcsvUserAgentFromEnv(env: NodeJS.Dict<string | undefined> = process.env): string {
  const raw = env.CARD_FLOW_TCGCSV_USER_AGENT?.trim();
  return raw || TCGCSV_DEFAULT_USER_AGENT;
}

export function tcgcsvRequestDelayMsFromEnv(env: NodeJS.Dict<string | undefined> = process.env): number {
  const raw = env.CARD_FLOW_TCGCSV_REQUEST_DELAY_MS?.trim();
  if (!raw) return TCGCSV_DELAY_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : TCGCSV_DELAY_MS;
}

export function tcgcsvCategoryIdFromEnv(env: NodeJS.Dict<string | undefined> = process.env): number {
  const raw = env.CARD_FLOW_TCGCSV_CATEGORY_ID?.trim();
  if (!raw) return TCGCSV_POKEMON_CATEGORY_ID;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : TCGCSV_POKEMON_CATEGORY_ID;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

export function parseTcgcsvLastUpdated(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("tcgcsv: empty last-updated.txt");
  return trimmed;
}

function parseExtendedData(value: unknown): TcgcsvProductRef["extendedData"] {
  if (!Array.isArray(value)) return [];
  const out: NonNullable<TcgcsvProductRef["extendedData"]> = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    out.push({
      name: asString(row.name) ?? null,
      displayName: asString(row.displayName) ?? null,
      value: asString(row.value) ?? null,
    });
  }
  return out;
}

export function parseTcgcsvGroup(value: unknown): TcgcsvGroupRef | null {
  if (!isRecord(value)) return null;
  const groupId = asNumber(value.groupId);
  const name = asString(value.name);
  if (groupId == null || !name) return null;
  return { groupId, name, abbreviation: asString(value.abbreviation) ?? null };
}

export function parseTcgcsvProduct(value: unknown): TcgcsvProductRef | null {
  if (!isRecord(value)) return null;
  const productId = asNumber(value.productId);
  if (productId == null) return null;
  return {
    productId,
    name: asString(value.name) ?? null,
    imageUrl: asString(value.imageUrl) ?? null,
    extendedData: parseExtendedData(value.extendedData),
  };
}

export function parseTcgcsvPrice(value: unknown): TcgcsvPriceRef | null {
  if (!isRecord(value)) return null;
  const productId = asNumber(value.productId);
  if (productId == null) return null;
  const market =
    typeof value.marketPrice === "number" && Number.isFinite(value.marketPrice) ? value.marketPrice : null;
  return {
    productId,
    marketPrice: market,
    subTypeName: asString(value.subTypeName) ?? null,
  };
}

function parseResults<T>(value: unknown, parse: (row: unknown) => T | null, label: string): T[] {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new Error(`tcgcsv: unexpected ${label} response shape`);
  }
  if (value.success === false) {
    const errors = Array.isArray(value.errors) ? value.errors.join("; ") : "success=false";
    throw new Error(`tcgcsv: ${label} failed (${errors})`);
  }
  return value.results.map(parse).filter((row): row is T => row != null);
}

export function parseTcgcsvGroups(value: unknown): TcgcsvGroupRef[] {
  return parseResults(value, parseTcgcsvGroup, "groups");
}

export function parseTcgcsvProducts(value: unknown): TcgcsvProductRef[] {
  return parseResults(value, parseTcgcsvProduct, "products");
}

export function parseTcgcsvPrices(value: unknown): TcgcsvPriceRef[] {
  return parseResults(value, parseTcgcsvPrice, "prices");
}

export async function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchTcgcsvOptions {
  fetchImpl?: typeof fetch;
  userAgent?: string;
  timeoutMs?: number;
  categoryId?: number;
}

function headers(userAgent: string): Record<string, string> {
  return { Accept: "application/json", "User-Agent": userAgent };
}

async function fetchTcgcsv(
  path: string,
  options: FetchTcgcsvOptions,
  accept: "json" | "text",
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? tcgcsvUserAgentFromEnv();
  const timeoutMs = options.timeoutMs ?? TCGCSV_TIMEOUT_MS;
  const url = path.startsWith("http") ? path : `${TCGCSV_API_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers: headers(userAgent), signal: controller.signal });
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "");
      const error = new Error("tcgcsv rate limited") as Error & { status: number; retryAfterMs: number };
      error.status = 429;
      error.retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5_000;
      throw error;
    }
    if (!response.ok) {
      throw new Error(`tcgcsv HTTP ${response.status} for ${path}`);
    }
    return accept === "text" ? response.text() : response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTcgcsvWithRetry<T>(
  run: () => Promise<T>,
  options: { sleep?: (ms: number) => Promise<void>; maxRetries?: number } = {},
): Promise<T> {
  const sleep = options.sleep ?? sleepMs;
  const maxRetries = options.maxRetries ?? TCGCSV_MAX_RETRIES;
  let attempt = 0;
  while (true) {
    try {
      return await run();
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

export async function fetchTcgcsvLastUpdated(options: FetchTcgcsvOptions = {}): Promise<string> {
  const body = await fetchTcgcsv("/last-updated.txt", options, "text");
  return parseTcgcsvLastUpdated(String(body));
}

export async function fetchTcgcsvGroups(options: FetchTcgcsvOptions = {}): Promise<TcgcsvGroupRef[]> {
  const categoryId = options.categoryId ?? tcgcsvCategoryIdFromEnv();
  const body = await fetchTcgcsv(`/tcgplayer/${categoryId}/groups`, options, "json");
  return parseTcgcsvGroups(body);
}

export async function fetchTcgcsvProducts(
  groupId: number,
  options: FetchTcgcsvOptions = {},
): Promise<TcgcsvProductRef[]> {
  const categoryId = options.categoryId ?? tcgcsvCategoryIdFromEnv();
  const body = await fetchTcgcsv(`/tcgplayer/${categoryId}/${groupId}/products`, options, "json");
  return parseTcgcsvProducts(body);
}

export async function fetchTcgcsvPrices(
  groupId: number,
  options: FetchTcgcsvOptions = {},
): Promise<TcgcsvPriceRef[]> {
  const categoryId = options.categoryId ?? tcgcsvCategoryIdFromEnv();
  const body = await fetchTcgcsv(`/tcgplayer/${categoryId}/${groupId}/prices`, options, "json");
  return parseTcgcsvPrices(body);
}
