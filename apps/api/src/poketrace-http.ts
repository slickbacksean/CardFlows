import {
  applyGradedMarketSummary,
  emptySlabEstimate,
  hasPrepareGradedAmounts,
  hasPrepareMarketAmounts,
  POKETRACE_PUBLIC_ENDPOINT,
  slabEstimatesFromPoketracePrices,
  type CardFlowSlabEstimate,
  type SlabEstimateRequest,
  type SlabPricingProvider,
} from "@cardflow/shared";

export interface PoketraceHttpOptions {
  baseUrl?: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Host-only env values become `https://api.poketrace.com/v1`. */
export function normalizePoketraceBaseUrl(raw?: string | null): string {
  const trimmed = raw?.trim();
  if (!trimmed) return POKETRACE_PUBLIC_ENDPOINT;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.pathname || url.pathname === "/") url.pathname = "/v1";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return POKETRACE_PUBLIC_ENDPOINT;
  }
}

export function joinPoketraceUrl(baseUrl: string, pathName: string): string {
  const base = normalizePoketraceBaseUrl(baseUrl).replace(/\/+$/, "");
  const path = pathName.startsWith("/") ? pathName : `/${pathName}`;
  return `${base}${path}`;
}

export function tcgdexIdParts(tcgdexId: string): { setId: string; localId: string } | null {
  const trimmed = tcgdexId.trim();
  const idx = trimmed.indexOf("-");
  if (idx <= 0 || idx === trimmed.length - 1) return null;
  return { setId: trimmed.slice(0, idx), localId: trimmed.slice(idx + 1) };
}

export function normalizePoketraceCardNumber(value: string): string {
  const left = value.trim().split("/")[0]?.trim() ?? "";
  const stripped = left.replace(/^0+/, "");
  return (stripped || "0").toUpperCase();
}

export function poketraceCardNumberMatches(cardNumber: string | null, localId: string | null): boolean {
  if (!cardNumber || !localId) return false;
  return normalizePoketraceCardNumber(cardNumber) === normalizePoketraceCardNumber(localId);
}

function kebab(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Only send `set=` when the catalog name looks like a PokeTrace slug ("Base Set" → base-set). */
export function poketraceSetSlug(setName?: string | null): string | undefined {
  const name = setName?.trim();
  if (!name) return undefined;
  if (!/[a-z0-9]\s+[a-z0-9]/i.test(name) && !name.includes("-")) return undefined;
  const slug = kebab(name);
  return slug || undefined;
}

function pricesFromBody(body: unknown): Record<string, Record<string, unknown>> | null {
  if (!isRecord(body)) return null;
  if (isRecord(body.prices)) {
    return body.prices as Record<string, Record<string, unknown>>;
  }
  if (isRecord(body.data) && isRecord(body.data.prices)) {
    return body.data.prices as Record<string, Record<string, unknown>>;
  }
  return null;
}

function cardsFromBody(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter(isRecord);
  if (!isRecord(body)) return [];
  if (Array.isArray(body.data)) return body.data.filter(isRecord);
  if (isRecord(body.data)) return [body.data];
  return [body];
}

function cardId(card: Record<string, unknown>): string | null {
  return asString(card.id);
}

function scoreCard(card: Record<string, unknown>, req: SlabEstimateRequest): number {
  const localId = asString(req.localId) ?? tcgdexIdParts(req.tcgdexId)?.localId ?? null;
  const cardNumber = asString(card.cardNumber) ?? asString(card.card_number);
  if (!poketraceCardNumberMatches(cardNumber, localId)) return -1;
  let score = 10;
  const name = asString(card.name)?.toLowerCase() ?? "";
  const wantName = asString(req.name)?.toLowerCase() ?? "";
  if (wantName && name === wantName) score += 5;
  else if (wantName && name.startsWith(wantName)) score += 2;
  const set = isRecord(card.set) ? card.set : {};
  const slug = asString(set.slug)?.toLowerCase() ?? "";
  const setName = asString(set.name)?.toLowerCase() ?? "";
  const wantSetName = asString(req.setName)?.toLowerCase() ?? "";
  const wantSetId = asString(req.setId)?.toLowerCase() ?? "";
  if (wantSetName && (setName === wantSetName || slug === kebab(wantSetName))) score += 4;
  if (wantSetId && (slug === wantSetId || slug.includes(wantSetId))) score += 2;
  if (card.hasGraded === true) score += 1;
  return score;
}

function pickCard(
  cards: Record<string, unknown>[],
  req: SlabEstimateRequest,
): Record<string, unknown> | null {
  let best: Record<string, unknown> | null = null;
  let bestScore = -1;
  for (const card of cards) {
    const score = scoreCard(card, req);
    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  }
  return bestScore >= 10 ? best : null;
}

function estimateFromPrices(tcgdexId: string, prices: Record<string, Record<string, unknown>> | null) {
  return slabEstimatesFromPoketracePrices(
    tcgdexId,
    prices as Parameters<typeof slabEstimatesFromPoketracePrices>[1],
  );
}

export function createPoketraceSlabProvider(options: PoketraceHttpOptions): SlabPricingProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 7000;
  const baseUrl = normalizePoketraceBaseUrl(options.baseUrl);
  const apiKey = options.apiKey.trim();

  async function request(pathName: string, attempt = 0): Promise<unknown | null> {
    if (!apiKey) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(joinPoketraceUrl(baseUrl, pathName), {
        headers: {
          accept: "application/json",
          "X-API-Key": apiKey,
        },
        signal: controller.signal,
      });
      if (response.status === 429 && attempt < 1) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 4000) : 1200;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return request(pathName, attempt + 1);
      }
      if (!response.ok) return null;
      return (await response.json()) as unknown;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: "poketrace",
    async getSlabEstimates(req: SlabEstimateRequest): Promise<CardFlowSlabEstimate> {
      const empty = emptySlabEstimate(req.tcgdexId, "none");
      if (!apiKey || !req.tcgdexId.trim()) return empty;
      const parts = tcgdexIdParts(req.tcgdexId);
      const name = asString(req.name);
      const localId = asString(req.localId) ?? parts?.localId ?? null;
      if (!name || !localId) return empty;

      const wanted = { ...req, name, localId };

      async function searchCards(setSlug?: string): Promise<{
        match: Record<string, unknown> | null;
        failed: boolean;
      }> {
        const params = new URLSearchParams({
          search: name,
          market: "US",
          game: "pokemon",
          limit: "20",
        });
        if (setSlug) params.set("set", setSlug);
        const listBody = await request(`/cards?${params.toString()}`);
        if (!listBody) return { match: null, failed: true };
        return { match: pickCard(cardsFromBody(listBody), wanted), failed: false };
      }

      async function matchBySetLookup(): Promise<Record<string, unknown> | null> {
        const setName = asString(req.setName);
        if (!setName) return null;
        const setsBody = await request(
          `/sets?search=${encodeURIComponent(setName)}&game=pokemon&limit=8`,
        );
        if (!setsBody) return null;
        const tried = poketraceSetSlug(setName);
        const slugs = setSlugsFromBody(setsBody)
          .filter((slug) => slug !== tried)
          .sort((left, right) => right.length - left.length)
          .slice(0, 4);
        for (const slug of slugs) {
          const found = await searchCards(slug);
          if (found.failed) return null;
          if (found.match) return found.match;
        }
        return null;
      }

      const first = await searchCards(poketraceSetSlug(req.setName));
      if (first.failed) return empty;
      const match = first.match ?? (await matchBySetLookup());
      if (!match) return empty;

      let estimate = estimateFromPrices(req.tcgdexId, pricesFromBody(match));
      let summary = gradedSummary(match);
      const id = cardId(match);
      // List prices are raw condition tiers. Card detail carries gradedOptions and topPrice.
      // Per-grade history stays off: Free plan returns 403 UPGRADE_REQUIRED.
      if (id && !hasPrepareGradedAmounts(estimate)) {
        const detail = await request(`/cards/${encodeURIComponent(id)}`);
        const detailCard = cardRecord(detail);
        if (detailCard) summary = gradedSummary(detailCard);
        const detailed = estimateFromPrices(req.tcgdexId, pricesFromBody(detail));
        if (hasPrepareGradedAmounts(detailed)) estimate = detailed;
        else if (!hasPrepareMarketAmounts(estimate) && hasPrepareMarketAmounts(detailed)) {
          estimate = detailed;
        }
      }
      estimate = applyGradedMarketSummary(estimate, summary);
      if (
        !hasPrepareMarketAmounts(estimate) &&
        estimate.topAmountCents === null &&
        estimate.gradedTiers.length === 0
      ) {
        return empty;
      }
      return estimate;
    },
  };
}

function setSlugsFromBody(body: unknown): string[] {
  const slugs: string[] = [];
  for (const row of cardsFromBody(body)) {
    const slug = asString(row.slug);
    if (!slug || slugs.includes(slug)) continue;
    slugs.push(slug);
  }
  return slugs;
}

function cardRecord(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body)) return null;
  if (isRecord(body.data)) return body.data;
  if (Array.isArray(body.data)) {
    const first = body.data.find(isRecord);
    return first ?? null;
  }
  return body;
}

function gradedSummary(card: Record<string, unknown> | null): {
  topPrice: number | null;
  gradedOptions: string[];
} {
  if (!card) return { topPrice: null, gradedOptions: [] };
  const topPrice =
    typeof card.topPrice === "number" && Number.isFinite(card.topPrice) && card.topPrice > 0
      ? card.topPrice
      : null;
  const gradedOptions = Array.isArray(card.gradedOptions)
    ? card.gradedOptions.filter((tier): tier is string => typeof tier === "string")
    : [];
  return { topPrice, gradedOptions };
}
