import {
  centsToDollarString,
  firstPricedPrinting,
  hasTcgplayerMarket,
  marketCentsForPrinting,
  tcgplayerMarketCents,
  type TcgplayerMarketCents,
} from "@cardflow/shared";
import { getPriceEstimate } from "@/lib/api";

const TCGDEX_CARDS = "https://api.tcgdex.net/v2/en";
const PAGE_SIZE = 100;
const REQUEST_LIMIT = 4;

export interface ShopCardBrief {
  id: string;
  localId: string;
  name: string;
  imageUrl: string | null;
  rarity?: string | null;
  amountCents?: number | null;
}

export interface ShopAttack {
  name: string;
  damage: string | null;
  effect: string | null;
  cost: string[];
}

export interface ShopWeakness {
  type: string;
  value: string;
}

export interface ShopVariants {
  firstEdition: boolean;
  holo: boolean;
  normal: boolean;
  reverse: boolean;
}

export interface ShopVariantChoice {
  label: string;
  query: string;
}

export interface ShopSetInfo {
  id: string;
  name: string;
  releaseDate: string | null;
  serieName: string | null;
  logoUrl: string | null;
}

export interface ShopCardDetail {
  id: string;
  localId: string;
  name: string;
  imageUrl: string | null;
  rarity: string | null;
  illustrator: string | null;
  dexId: number | null;
  retreat: number | null;
  weaknesses: ShopWeakness[];
  attacks: ShopAttack[];
  variants: ShopVariants;
  set: ShopSetInfo;
  tcgplayerProductId: number | null;
  marketPrices: TcgplayerMarketCents;
}

interface CachedSet {
  info: ShopSetInfo;
  cards: ShopCardBrief[];
}

const artCache = new Map<string, string | null>();
const artPending = new Map<string, Promise<string | null>>();
const printsCache = new Map<string, ShopCardBrief[]>();
const printsPending = new Map<string, Promise<ShopCardBrief[]>>();
const detailCache = new Map<string, ShopCardDetail>();
const rawCache = new Map<string, Record<string, unknown>>();
const setCache = new Map<string, CachedSet>();

export function shopMarketAmount(
  prices: TcgplayerMarketCents,
  printing: string | null | undefined,
): string | null {
  const cents = marketCentsForPrinting(prices, printing);
  return cents === null ? null : centsToDollarString(cents);
}

let activeRequests = 0;
const requestQueue: (() => void)[] = [];

function runLimited<T>(work: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = () => {
      activeRequests += 1;
      work()
        .then(resolve, reject)
        .finally(() => {
          activeRequests -= 1;
          requestQueue.shift()?.();
        });
    };
    if (activeRequests < REQUEST_LIMIT) start();
    else requestQueue.push(start);
  });
}

export function normalizeCardName(value: string): string {
  return value.normalize("NFKC").replace(/[’']/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

export function isSpeciesCard(cardName: string, pokemonName: string): boolean {
  const card = normalizeCardName(cardName);
  const pokemon = normalizeCardName(pokemonName);
  if (!pokemon) return false;
  if (card === pokemon) return true;
  return ` ${card} `.includes(` ${pokemon} `);
}

const POCKET_SET_ID = /^(?:[ab]\d+[a-z]?|p-a)$/i;

function cardSetId(cardId: string): string {
  if (/^p-a-/i.test(cardId)) return "p-a";
  return cardId.split("-")[0] ?? "";
}

/** TCG Pocket prints are not sold on TCGPlayer and have no market price. */
export function isPhysicalShopCard(card: { id: string; imageUrl?: string | null }): boolean {
  if (POCKET_SET_ID.test(cardSetId(card.id))) return false;
  if (card.imageUrl && /\/tcgp\//i.test(card.imageUrl)) return false;
  return true;
}

function suffixedAsset(base: string | null | undefined): string | null {
  if (!base) return null;
  const trimmed = base.replace(/\/+$/, "");
  if (!trimmed) return null;
  if (/\.(webp|png|jpe?g)$/i.test(trimmed)) return trimmed;
  return `${trimmed}.webp`;
}

export function cardArtUrl(
  base: string | null | undefined,
  quality: "low" | "high" = "low",
): string | null {
  if (!base) return null;
  const trimmed = base.replace(/\/+$/, "");
  if (!trimmed) return null;
  if (/\.(webp|png|jpe?g)$/i.test(trimmed)) return trimmed;
  return `${trimmed}/${quality}.webp`;
}

export function variantChoices(variants: ShopVariants): ShopVariantChoice[] {
  const choices: ShopVariantChoice[] = [];
  if (variants.normal) choices.push({ label: "Normal", query: "normal" });
  if (variants.holo) choices.push({ label: "Holo", query: "holo" });
  if (variants.reverse) choices.push({ label: "Reverse", query: "reverse" });
  if (variants.firstEdition) choices.push({ label: "1st Edition", query: "first edition" });
  if (choices.length === 0) choices.push({ label: "Normal", query: "normal" });
  return choices;
}

export function defaultVariant(variants: ShopVariants): ShopVariantChoice {
  const choices = variantChoices(variants);
  if (variants.holo && !variants.normal) {
    return choices.find((choice) => choice.query === "holo") ?? choices[0]!;
  }
  return choices[0]!;
}

/** Opens on the usual printing when it has a market price, otherwise the first priced one. */
export function pricedVariant(
  variants: ShopVariants,
  prices: TcgplayerMarketCents,
): ShopVariantChoice {
  const choices = variantChoices(variants);
  const preferred = firstPricedPrinting(
    prices,
    choices.map((choice) => choice.query),
  );
  return choices.find((choice) => choice.query === preferred) ?? defaultVariant(variants);
}

export function tcgplayerUrl(card: {
  name: string;
  localId: string;
  setName: string;
  tcgplayerProductId: number | null;
}): string {
  if (card.tcgplayerProductId) {
    return `https://www.tcgplayer.com/product/${card.tcgplayerProductId}`;
  }
  const query = encodeURIComponent(`${card.name} ${card.localId} ${card.setName}`);
  return `https://www.tcgplayer.com/search/pokemon/product?q=${query}&view=grid&ProductTypeName=Cards`;
}

export function ebayUrl(card: { name: string; localId: string; setName: string }): string {
  const query = encodeURIComponent(`pokemon card ${card.name} ${card.localId} ${card.setName}`);
  return `https://www.ebay.com/sch/i.html?_nkw=${query}&LH_BIN=1`;
}

export function formatReleaseDate(iso: string | null): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function loadDefaultCardArt(pokemonName: string): Promise<string | null> {
  const key = normalizeCardName(pokemonName);
  if (!key) return Promise.resolve(null);
  const cached = artCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = artPending.get(key);
  if (pending) return pending;
  const job = runLimited(() => fetchDefaultArt(pokemonName))
    .then((url) => {
      artCache.set(key, url);
      return url;
    })
    .catch(() => {
      artCache.set(key, null);
      return null;
    })
    .finally(() => {
      artPending.delete(key);
    });
  artPending.set(key, job);
  return job;
}

export function loadPrints(pokemonName: string): Promise<ShopCardBrief[]> {
  const key = normalizeCardName(pokemonName);
  const cached = printsCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = printsPending.get(key);
  if (pending) return pending;
  const job = fetchPrints(pokemonName)
    .then((cards) => {
      printsCache.set(key, cards);
      const art = cards.find((card) => card.imageUrl)?.imageUrl ?? null;
      if (!artCache.has(key)) artCache.set(key, art);
      return cards;
    })
    .finally(() => {
      printsPending.delete(key);
    });
  printsPending.set(key, job);
  return job;
}

export async function loadSetPrints(setId: string): Promise<ShopCardBrief[]> {
  const cached = setCache.get(setId);
  if (cached) return cached.cards;
  const loaded = await fetchSet(setId);
  return loaded.cards;
}

export async function loadCardDetail(cardId: string): Promise<ShopCardDetail> {
  const cached = detailCache.get(cardId);
  if (cached) return cached;
  const raw = await loadCardRaw(cardId);
  const setRaw = isRecord(raw.set) ? raw.set : {};
  const setId = typeof setRaw.id === "string" ? setRaw.id : "";
  const setName = typeof setRaw.name === "string" ? setRaw.name : "Set";
  let setInfo: ShopSetInfo = {
    id: setId,
    name: setName,
    releaseDate: null,
    serieName: null,
    logoUrl: null,
  };
  if (setId) {
    try {
      setInfo = (await fetchSet(setId)).info;
    } catch {
      setInfo = { ...setInfo, name: setName };
    }
  }
  const cardIdFromRaw = typeof raw.id === "string" ? raw.id : cardId;
  const detail: ShopCardDetail = {
    id: cardIdFromRaw,
    localId: typeof raw.localId === "string" ? raw.localId : cardIdFromRaw,
    name: typeof raw.name === "string" ? raw.name : "Card",
    imageUrl: cardArtUrl(typeof raw.image === "string" ? raw.image : null, "high"),
    rarity: typeof raw.rarity === "string" ? raw.rarity : null,
    illustrator: typeof raw.illustrator === "string" ? raw.illustrator : null,
    dexId: firstDexId(raw.dexId),
    retreat: typeof raw.retreat === "number" ? raw.retreat : null,
    weaknesses: parseWeaknesses(raw.weaknesses),
    attacks: parseAttacks(raw.attacks),
    variants: parseVariants(raw.variants),
    set: setInfo,
    tcgplayerProductId: tcgplayerProductId(raw.variants_detailed),
    marketPrices: tcgplayerMarketCents(raw, parseVariants(raw.variants)),
  };
  detailCache.set(cardId, detail);
  return detail;
}

export async function withPriceEstimates(cards: ShopCardBrief[]): Promise<ShopCardBrief[]> {
  let failures = 0;
  return mapPool(cards, REQUEST_LIMIT, async (card) => {
    if (card.amountCents !== undefined) return card;
    try {
      const raw = await loadCardRaw(card.id);
      const variants = parseVariants(raw.variants);
      const prices = tcgplayerMarketCents(raw, variants);
      if (hasTcgplayerMarket(prices)) {
        const printing = pricedVariant(variants, prices).query;
        return { ...card, amountCents: marketCentsForPrinting(prices, printing) };
      }
    } catch {
      failures += 1;
    }
    if (failures >= 3) return { ...card, amountCents: null };
    try {
      const response = await getPriceEstimate(card.id);
      return { ...card, amountCents: response.estimate.amountCents };
    } catch {
      failures += 1;
      return { ...card, amountCents: null };
    }
  });
}

export async function withRarities(cards: ShopCardBrief[]): Promise<ShopCardBrief[]> {
  return mapPool(cards, REQUEST_LIMIT, async (card) => {
    if (card.rarity !== undefined) return card;
    try {
      const detail = await loadCardDetail(card.id);
      return { ...card, rarity: detail.rarity };
    } catch {
      return { ...card, rarity: null };
    }
  });
}

async function fetchDefaultArt(pokemonName: string): Promise<string | null> {
  const rows = await fetchNamePage(pokemonName, 1, 40);
  const matches = rows.filter(
    (card) => isSpeciesCard(card.name, pokemonName) && isPhysicalShopCard(card) && card.imageUrl,
  );
  const exact = matches.find((card) => normalizeCardName(card.name) === normalizeCardName(pokemonName));
  return (exact ?? matches[0])?.imageUrl ?? null;
}

async function fetchPrints(pokemonName: string): Promise<ShopCardBrief[]> {
  const cards: ShopCardBrief[] = [];
  for (let page = 1; page <= 8; page += 1) {
    const rows = await fetchNamePage(pokemonName, page, PAGE_SIZE);
    for (const card of rows) {
      if (isSpeciesCard(card.name, pokemonName) && isPhysicalShopCard(card)) cards.push(card);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return sortPrints(dedupe(cards), pokemonName);
}

async function fetchNamePage(
  pokemonName: string,
  page: number,
  pageSize: number,
): Promise<ShopCardBrief[]> {
  const params = new URLSearchParams();
  params.set("name", pokemonName);
  params.set("pagination:page", String(page));
  params.set("pagination:itemsPerPage", String(pageSize));
  const payload = await fetchJson(`${TCGDEX_CARDS}/cards?${params.toString()}`);
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((row) => {
    const brief = parseBrief(row, "low");
    return brief ? [brief] : [];
  });
}

async function fetchSet(setId: string): Promise<CachedSet> {
  const cached = setCache.get(setId);
  if (cached) return cached;
  const payload = await fetchJson(`${TCGDEX_CARDS}/sets/${encodeURIComponent(setId)}`);
  if (!isRecord(payload)) throw new Error("That set could not be found.");
  const serie = isRecord(payload.serie) ? payload.serie : null;
  const info: ShopSetInfo = {
    id: typeof payload.id === "string" ? payload.id : setId,
    name: typeof payload.name === "string" ? payload.name : "Set",
    releaseDate: typeof payload.releaseDate === "string" ? payload.releaseDate : null,
    serieName: serie && typeof serie.name === "string" ? serie.name : null,
    logoUrl: suffixedAsset(typeof payload.logo === "string" ? payload.logo : null),
  };
  const cards = Array.isArray(payload.cards)
    ? sortPrints(
        dedupe(
          payload.cards.flatMap((row) => {
            const brief = parseBrief(row, "low");
            return brief ? [brief] : [];
          }),
        ),
      )
    : [];
  const loaded = { info, cards };
  setCache.set(setId, loaded);
  return loaded;
}

async function loadCardRaw(cardId: string): Promise<Record<string, unknown>> {
  const cached = rawCache.get(cardId);
  if (cached) return cached;
  const raw = await fetchJson(`${TCGDEX_CARDS}/cards/${encodeURIComponent(cardId)}`);
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") {
    throw new Error("That card could not be found.");
  }
  rawCache.set(cardId, raw);
  return raw;
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("Could not reach the card catalog.");
    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof Error && error.message === "Could not reach the card catalog.") throw error;
    throw new Error("Could not reach the card catalog.");
  } finally {
    clearTimeout(timer);
  }
}

function parseBrief(value: unknown, quality: "low" | "high"): ShopCardBrief | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }
  return {
    id: value.id,
    localId: typeof value.localId === "string" ? value.localId : value.id,
    name: value.name,
    imageUrl: cardArtUrl(typeof value.image === "string" ? value.image : null, quality),
  };
}

function parseVariants(value: unknown): ShopVariants {
  const record = isRecord(value) ? value : {};
  return {
    firstEdition: Boolean(record.firstEdition),
    holo: Boolean(record.holo),
    normal: record.normal !== false,
    reverse: Boolean(record.reverse),
  };
}

function parseWeaknesses(value: unknown): ShopWeakness[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row) || typeof row.type !== "string") return [];
    const amount = typeof row.value === "string" ? row.value.replace(/x/gi, "×") : "×2";
    return [{ type: row.type, value: amount }];
  });
}

function parseAttacks(value: unknown): ShopAttack[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row) || typeof row.name !== "string") return [];
    const cost = Array.isArray(row.cost)
      ? row.cost.filter((energy): energy is string => typeof energy === "string")
      : [];
    return [
      {
        name: row.name,
        damage: row.damage === undefined || row.damage === null ? null : String(row.damage),
        effect: typeof row.effect === "string" ? row.effect : null,
        cost,
      },
    ];
  });
}

function firstDexId(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function tcgplayerProductId(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  for (const row of value) {
    if (!isRecord(row) || !isRecord(row.thirdParty)) continue;
    const productId = row.thirdParty.tcgplayer;
    if (typeof productId === "number" && productId > 0) return productId;
  }
  return null;
}

function sortPrints(cards: ShopCardBrief[], pokemonName?: string): ShopCardBrief[] {
  const pokemon = pokemonName ? normalizeCardName(pokemonName) : "";
  return [...cards].sort((left, right) => printRank(left, pokemon) - printRank(right, pokemon));
}

function printRank(card: ShopCardBrief, pokemon: string): number {
  const exact = pokemon !== "" && normalizeCardName(card.name) === pokemon;
  if (exact && card.imageUrl) return 0;
  if (card.imageUrl) return 1;
  if (exact) return 2;
  return 3;
}

function dedupe(cards: ShopCardBrief[]): ShopCardBrief[] {
  const seen = new Set<string>();
  const next: ShopCardBrief[] = [];
  for (const card of cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    next.push(card);
  }
  return next;
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      const item = items[current];
      if (item === undefined) continue;
      results[current] = await worker(item);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => run()));
  return results;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
