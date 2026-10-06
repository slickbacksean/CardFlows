import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CatalogProviderError,
  emptyPriceEstimate,
  PRICE_ESTIMATE_LABEL,
} from "@cardflow/shared";
import { createApp } from "./app";
import { createMemoryStore } from "./store";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";
import { createPokecollectorCatalogProvider } from "./pokecollector-catalog";
import {
  createPokecollectorPricingProvider,
  estimateFromPokecollectorCard,
} from "./pokecollector-pricing";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(srcDir, "../../..");

const PIKACHU_POKE = {
  id: "base1-58_en",
  tcg_card_id: "base1-58",
  name: "Pikachu",
  set_id: "base1",
  number: "58",
  rarity: "Common",
  supertype: "Pokémon",
  artist: "Mitsuhiro Arita",
  images_small: "http://127.0.0.1:8000/api/images/card/base1-58_en/small",
  images_large: "https://assets.tcgdex.net/en/base/base1/58/high.webp",
  price_market: 2.5,
  price_tcg_normal_market: 8.25,
  variants_normal: true,
  variants_holo: false,
  variants_reverse: false,
  variants_first_edition: false,
  set_ref: {
    id: "base1_en",
    tcg_set_id: "base1",
    name: "Base Set",
    series: "base",
    total: 102,
    printed_total: 102,
    lang: "en",
    images_logo: "https://assets.tcgdex.net/en/base/base1/logo",
  },
};

/** Live GHCR 1.51.0 search/detail shape: `id` has `_en`, `tcg_card_id` is null. */
const PIKACHU_POKE_LIVE = {
  ...PIKACHU_POKE,
  tcg_card_id: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function expectNoVendorLeak(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(/"pricing"\s*:/);
  expect(serialized).not.toContain("price_tcg_normal_market");
  expect(serialized).not.toContain("price_market");
  expect(serialized).not.toContain("127.0.0.1:8000");
  expect(serialized).not.toContain("/api/cards");
  expect(serialized).not.toContain("/api/images");
  expect(serialized).not.toMatch(/Bearer\s+\S+/);
  expect(serialized).not.toContain("pokecollector-secret");
}

describe("PokéCollector catalog + pricing HTTP ports", () => {
  it("GET base1-58 returns catalog fields with constructed TCGdex art and no vendor prices", async () => {
    const urls: string[] = [];
    const catalog = createPokecollectorCatalogProvider({
      baseUrl: "http://127.0.0.1:8000",
      token: "pokecollector-secret",
      sleep: async () => undefined,
      fetchImpl: async (input) => {
        urls.push(requestUrl(input));
        return jsonResponse(PIKACHU_POKE);
      },
    });

    const card = await catalog.getCardById("base1-58", "en");
    expect(catalog.name).toBe("pokecollector");
    expect(card).toMatchObject({
      id: "base1-58",
      localId: "58",
      name: "Pikachu",
      language: "en",
      set: { id: "base1", name: "Base Set" },
    });
    expect(card?.image).toBe("https://assets.tcgdex.net/en/base/base1/58");
    expect(card).not.toHaveProperty("pricing");
    expectNoVendorLeak(card);
    expect(urls[0]).toContain("/api/cards/base1-58_en");
    expect(await catalog.getCardById("base1-58", "fr")).toBeNull();
  });

  it("resolves set + localId through English search", async () => {
    const catalog = createPokecollectorCatalogProvider({
      baseUrl: "http://127.0.0.1:8000",
      sleep: async () => undefined,
      fetchImpl: async (input) => {
        const url = requestUrl(input);
        if (url.includes("/api/cards/search")) return jsonResponse({ items: [PIKACHU_POKE] });
        return jsonResponse({ error: "missing" }, 404);
      },
    });
    const card = await catalog.getCardBySetAndLocalId("base1", "58", "en");
    expect(card?.id).toBe("base1-58");
  });

  it("fills a missing set name from the English set list", async () => {
    const { set_ref: _setRef, ...cardWithoutSet } = PIKACHU_POKE;
    const catalog = createPokecollectorCatalogProvider({
      baseUrl: "http://127.0.0.1:8000",
      sleep: async () => undefined,
      fetchImpl: async (input) => {
        const url = requestUrl(input);
        if (url.includes("/api/sets")) {
          return jsonResponse({
            data: [{ tcg_set_id: "base1", name: "Base Set", lang: "en" }],
          });
        }
        return jsonResponse(cardWithoutSet);
      },
    });
    const card = await catalog.getCardById("base1-58", "en");
    expect(card?.set).toMatchObject({ id: "base1", name: "Base Set" });
  });

  it("maps live 1.51.0 detail when tcg_card_id is null", async () => {
    const catalog = createPokecollectorCatalogProvider({
      baseUrl: "http://127.0.0.1:8000",
      sleep: async () => undefined,
      fetchImpl: async () => jsonResponse(PIKACHU_POKE_LIVE),
    });
    const card = await catalog.getCardById("base1-58", "en");
    expect(card).toMatchObject({
      id: "base1-58",
      localId: "58",
      name: "Pikachu",
      set: { id: "base1", name: "Base Set" },
    });
  });

  it("reads live search envelopes that wrap rows in data", async () => {
    const catalog = createPokecollectorCatalogProvider({
      baseUrl: "http://127.0.0.1:8000",
      sleep: async () => undefined,
      fetchImpl: async (input) => {
        const url = requestUrl(input);
        if (url.includes("/api/cards/search")) {
          return jsonResponse({
            data: [PIKACHU_POKE_LIVE],
            total_count: 1,
            page: 1,
            page_size: 20,
          });
        }
        return jsonResponse({ error: "missing" }, 404);
      },
    });
    const card = await catalog.getCardBySetAndLocalId("base1", "58", "en");
    expect(card?.id).toBe("base1-58");
  });

  it("prefers TCGPlayer USD cents and converts Cardmarket EUR otherwise", () => {
    const usd = estimateFromPokecollectorCard("base1-58", PIKACHU_POKE);
    expect(usd).toMatchObject({
      amountCents: 825,
      source: "tcgplayer_usd",
      label: PRICE_ESTIMATE_LABEL,
      notAMarket: true,
      notABid: true,
    });
    expect(usd.display).toContain("Estimate");

    const eurOnly = estimateFromPokecollectorCard(
      "base1-58",
      { ...PIKACHU_POKE, price_tcg_normal_market: null },
      { eurUsdRate: 1.1 },
    );
    expect(eurOnly).toMatchObject({
      amountCents: 275,
      source: "cardmarket_eur_converted",
    });
    expect(estimateFromPokecollectorCard("base1-58", { name: "Pikachu" })).toEqual(
      emptyPriceEstimate("base1-58"),
    );
  });

  it("serves GET /v1/catalog/cards/base1-58 and a separate USD pricing call", async () => {
    const catalog = createPokecollectorCatalogProvider({
      baseUrl: "http://127.0.0.1:8000",
      token: "pokecollector-secret",
      sleep: async () => undefined,
      fetchImpl: async () => jsonResponse(PIKACHU_POKE),
    });
    const pricing = createPokecollectorPricingProvider({
      baseUrl: "http://127.0.0.1:8000",
      token: "pokecollector-secret",
      sleep: async () => undefined,
      fetchImpl: async () => jsonResponse(PIKACHU_POKE),
    });
    const app = createApp(createMemoryStore(), { catalog, pricing });

    const catalogResponse = await app.request("/v1/catalog/cards/base1-58");
    expect(catalogResponse.status).toBe(200);
    const catalogBody = (await catalogResponse.json()) as {
      ok: boolean;
      provider: string;
      card: Record<string, unknown>;
    };
    expect(catalogBody).toMatchObject({
      ok: true,
      provider: "pokecollector",
      card: { id: "base1-58", localId: "58", name: "Pikachu" },
    });
    expectNoVendorLeak(catalogBody);

    const pricingResponse = await app.request("/v1/pricing/cards/base1-58");
    expect(pricingResponse.status).toBe(200);
    const pricingBody = (await pricingResponse.json()) as {
      ok: boolean;
      provider: string;
      estimate: { amountCents: number | null; label: string };
    };
    expect(pricingBody).toMatchObject({
      ok: true,
      provider: "pokecollector",
      estimate: { amountCents: 825, label: "estimate" },
    });
    expectNoVendorLeak(pricingBody);

    const health = await app.request("/health");
    expect(await health.json()).toMatchObject({
      catalog: "pokecollector",
      pricingProvider: "pokecollector",
    });
  });

  it("fails soft when PokéCollector is unreachable and Confirm still uses mock/cache", async () => {
    const stores: SqliteStorePort[] = [];
    const unreachable = {
      name: "pokecollector" as const,
      async getCardById(): Promise<never> {
        throw new CatalogProviderError({
          code: "PROVIDER_UNAVAILABLE",
          message: "down",
          retryable: true,
        });
      },
      async getCardBySetAndLocalId() {
        return null;
      },
      async resolveSetByName() {
        return [];
      },
      async listCards() {
        return [];
      },
    };
    const throwingPricing = {
      name: "pokecollector" as const,
      async getEstimate() {
        throw new Error("pricing down");
      },
    };

    const liveStore = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(liveStore);
    const liveApp = createApp(liveStore);
    const scan = await liveApp.request("/v1/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    const scanBody = (await scan.json()) as { scan: { scanId: string } };
    const confirmed = await liveApp.request(`/v1/scans/${scanBody.scan.scanId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tcgdexId: "base1-58" }),
    });
    const confirmedBody = (await confirmed.json()) as {
      confirmation: { confirmationId: string };
      canonicalCard: { cardflowCardId: string; name: string };
    };
    expect(confirmed.status).toBe(200);
    await liveApp.request("/v1/inventory/purchased", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confirmationId: confirmedBody.confirmation.confirmationId,
        purchasePrice: "10.50",
        purchasedAt: "2026-09-16",
      }),
    });

    const unplugged = createApp(liveStore, { catalog: unreachable, pricing: throwingPricing });
    const pricingResponse = await unplugged.request("/v1/pricing/cards/base1-58");
    expect(pricingResponse.status).toBe(200);
    expect(await pricingResponse.json()).toMatchObject({
      ok: true,
      estimate: { amountCents: null, label: "estimate" },
    });

    const inventory = await unplugged.request("/v1/inventory");
    expect(inventory.status).toBe(200);
    const inventoryBody = (await inventory.json()) as {
      items: Array<{ card: { name: string } | null }>;
    };
    expect(inventoryBody.items[0]?.card?.name).toBe("Pikachu");

    const detail = await unplugged.request(
      `/v1/cards/${confirmedBody.canonicalCard.cardflowCardId}`,
    );
    expect(detail.status).toBe(200);
    expectNoVendorLeak(await detail.json());

    for (const store of stores) store.close();
  });

  it("does not persist vendor pricing blobs on listing drafts", async () => {
    const catalog = createPokecollectorCatalogProvider({
      baseUrl: "http://127.0.0.1:8000",
      sleep: async () => undefined,
      fetchImpl: async () => jsonResponse(PIKACHU_POKE),
    });
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    const app = createApp(store, { catalog });
    const scan = await app.request("/v1/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    const scanBody = (await scan.json()) as { scan: { scanId: string } };
    const confirmed = await app.request(`/v1/scans/${scanBody.scan.scanId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tcgdexId: "base1-58" }),
    });
    const confirmedBody = (await confirmed.json()) as {
      confirmation: { confirmationId: string };
    };
    const purchased = await app.request("/v1/inventory/purchased", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confirmationId: confirmedBody.confirmation.confirmationId,
        purchasePrice: "10.50",
        purchasedAt: "2026-09-16",
      }),
    });
    const purchasedBody = (await purchased.json()) as { item: { inventoryItemId: string } };
    const draft = await app.request(
      `/v1/inventory/${purchasedBody.item.inventoryItemId}/drafts`,
      { method: "POST" },
    );
    expect(draft.status).toBe(201);
    const draftBody = await draft.json();
    expectNoVendorLeak(draftBody);
    store.close();
  });

  it("never retries 404 and maps 5xx after retries", async () => {
    let calls = 0;
    const catalog = createPokecollectorCatalogProvider({
      baseUrl: "http://127.0.0.1:8000",
      sleep: async () => undefined,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ error: "Not Found" }, 404);
      },
    });
    expect(await catalog.getCardById("not-a-real-id", "en")).toBeNull();
    expect(calls).toBe(1);

    let failures = 0;
    const failing = createPokecollectorCatalogProvider({
      baseUrl: "http://127.0.0.1:8000",
      sleep: async () => undefined,
      fetchImpl: async () => {
        failures += 1;
        return jsonResponse({ error: "upstream" }, 503);
      },
    });
    await expect(failing.getCardById("base1-58", "en")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
    });
    expect(failures).toBe(3);
  });

  it("keeps PokéCollector URLs and JWTs off the mobile client", () => {
    const mobileApi = readFileSync(path.join(repoRoot, "apps/mobile/lib/api.ts"), "utf8");
    const overlay = readFileSync(
      path.join(repoRoot, "apps/mobile/app/(tabs)/scan-tab.tsx"),
      "utf8",
    );
    const collection = readFileSync(
      path.join(repoRoot, "apps/mobile/app/(tabs)/collection.tsx"),
      "utf8",
    );
    expect(mobileApi).toContain("/v1/pricing/cards/");
    expect(mobileApi).not.toMatch(/127\.0\.0\.1:8000|\/api\/cards|\/api\/health/);
    expect(mobileApi).not.toMatch(/CARD_FLOW_POKECOLLECTOR_TOKEN|JWT_SECRET/);
    expect(overlay).not.toMatch(/127\.0\.0\.1:8000|\/api\/cards|Authorization: Bearer/i);
    expect(collection).not.toMatch(/127\.0\.0\.1:8000|\/api\/cards|Authorization: Bearer/i);
  });

  it("returns a null estimate when pricing is off", async () => {
    const app = createApp(createMemoryStore());
    const response = await app.request("/v1/pricing/cards/base1-58");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      provider: "off",
      estimate: { amountCents: null, tcgdexId: "base1-58", label: "estimate" },
    });
  });
});
