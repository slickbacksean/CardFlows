import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TCGDEX_PUBLIC_ENDPOINT,
  createDisabledTcgdexCatalogProvider,
} from "@cardflow/shared";
import { createApp } from "./app";
import { createMemoryStore } from "./store";
import { createTcgdexCatalogProvider } from "./tcgdex-catalog";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(srcDir, "../../..");

const PIKACHU_WIRE = {
  id: "base1-58",
  localId: "58",
  name: "Pikachu",
  category: "Pokemon",
  illustrator: "Mitsuhiro Arita",
  rarity: "Common",
  image: "https://assets.tcgdex.net/en/base/base1/58",
  pricing: { normal: { market: 12.34 } },
  variants_detailed: {
    reverse: { pricing: { market: 9.99 }, available: true },
  },
  set: {
    id: "base1",
    name: "Base Set",
    cardCount: { total: 102, official: 102 },
  },
  variants: {
    firstEdition: false,
    holo: false,
    normal: true,
    reverse: false,
  },
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

function createLiveCatalog(fetchImpl: typeof fetch, extra: { timeoutMs?: number } = {}) {
  return createTcgdexCatalogProvider({
    fetchImpl,
    timeoutMs: extra.timeoutMs,
    sleep: async () => undefined,
  });
}

describe("live TCGdex catalog adapter", () => {
  it("GET base1-58 returns catalog fields with no pricing key", async () => {
    const urls: string[] = [];
    const catalog = createLiveCatalog(async (input, init) => {
      urls.push(requestUrl(input));
      expect(init?.headers).not.toMatchObject({ authorization: expect.anything() });
      expect(init?.headers).not.toMatchObject({ "X-API-Key": expect.anything() });
      return jsonResponse(PIKACHU_WIRE);
    });

    const card = await catalog.getCardById("base1-58", "en");
    expect(catalog.name).toBe("tcgdex");
    expect(card).toMatchObject({
      id: "base1-58",
      localId: "58",
      name: "Pikachu",
      language: "en",
      set: { id: "base1", name: "Base Set" },
    });
    expect(card).not.toHaveProperty("pricing");
    expect(JSON.stringify(card)).not.toContain("pricing");
    expect(urls[0]).toContain(`${TCGDEX_PUBLIC_ENDPOINT}/en/cards/base1-58`);
  });

  it("serves GET /v1/catalog/cards/base1-58 without pricing when the flag is on", async () => {
    const catalog = createLiveCatalog(async () => jsonResponse(PIKACHU_WIRE));
    const app = createApp(createMemoryStore(), { catalog });
    const response = await app.request("/v1/catalog/cards/base1-58");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      provider: string;
      card: Record<string, unknown>;
    };
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("tcgdex");
    expect(body.card.id).toBe("base1-58");
    expect(body.card).not.toHaveProperty("pricing");
    expect(JSON.stringify(body)).not.toContain("pricing");
  });

  it("returns FEATURE_DISABLED when the catalog kill switch is on", async () => {
    const app = createApp(createMemoryStore(), {
      catalog: createDisabledTcgdexCatalogProvider(),
    });
    const response = await app.request("/v1/catalog/cards/base1-58");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "FEATURE_DISABLED", retryable: false },
    });
  });

  it("never retries 404 and never invents a TCGdex id", async () => {
    let calls = 0;
    const catalog = createLiveCatalog(async () => {
      calls += 1;
      return jsonResponse({ error: "Not Found" }, 404);
    });

    expect(await catalog.getCardById("not-a-real-id", "en")).toBeNull();
    expect(calls).toBe(1);
    expect(await catalog.getCardBySetAndLocalId("base1", "999", "en")).toBeNull();
    expect(await catalog.listCards({ language: "en" })).toEqual([]);
    expect(await catalog.getCardById("base1-58", "fr")).toBeNull();
  });

  it("retries 5xx at most twice then maps to PROVIDER_UNAVAILABLE", async () => {
    let calls = 0;
    const catalog = createLiveCatalog(async () => {
      calls += 1;
      return jsonResponse({ error: "upstream" }, 503);
    });

    await expect(catalog.getCardById("base1-58", "en")).rejects.toMatchObject({
      name: "CatalogProviderError",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
    });
    expect(calls).toBe(3);
  });

  it("retries 5xx and succeeds on the last attempt", async () => {
    let calls = 0;
    const catalog = createLiveCatalog(async () => {
      calls += 1;
      if (calls < 3) return jsonResponse({ error: "upstream" }, 503);
      return jsonResponse(PIKACHU_WIRE);
    });

    const card = await catalog.getCardById("base1-58", "en");
    expect(card?.id).toBe("base1-58");
    expect(calls).toBe(3);
  });

  it("times out without retrying", async () => {
    let calls = 0;
    const catalog = createLiveCatalog(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          calls += 1;
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
      { timeoutMs: 20 },
    );

    await expect(catalog.getCardById("base1-58", "en")).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
      retryable: true,
    });
    expect(calls).toBe(1);
  });

  it("does not invent a TCGDEX_API_KEY or self-host the catalog", () => {
    const adapter = readFileSync(path.join(srcDir, "tcgdex-catalog.ts"), "utf8");
    const envExample = readFileSync(path.join(repoRoot, "apps/api/.env.example"), "utf8");
    const env = readFileSync(path.join(srcDir, "catalog-env.ts"), "utf8");

    expect(adapter).toContain("new TCGdex(\"en\")");
    expect(adapter).toContain("setCacheTTL");
    expect(adapter).toContain("setEndpoint(TCGDEX_PUBLIC_ENDPOINT)");
    expect(adapter).not.toContain("TCGDEX_API_KEY");
    expect(adapter).not.toMatch(/tcgdex\/server|cards-database/);
    expect(env).not.toContain("TCGDEX_API_KEY");
    expect(envExample).not.toContain("TCGDEX_API_KEY");
    expect(envExample).toContain("CARD_FLOW_TCGDEX_CATALOG_ENABLED=");
  });
});
