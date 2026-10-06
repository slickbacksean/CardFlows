import { describe, expect, it } from "vitest";
import { createMockSlabPricingProvider, emptySlabEstimate } from "@cardflow/shared";
import {
  createPoketraceSlabProvider,
  joinPoketraceUrl,
  normalizePoketraceBaseUrl,
  normalizePoketraceCardNumber,
  poketraceCardNumberMatches,
  poketraceSetSlug,
} from "./poketrace-http";
import { createSlabPricingFromEnv, resolveSlabPricingSelection } from "./poketrace-env";

describe("PokeTrace slab env", () => {
  it("keeps CI off and never requires a key", () => {
    expect(resolveSlabPricingSelection({ VITEST: "true", CARD_FLOW_POKETRACE_ENABLED: "true" })).toEqual(
      { kind: "off", reason: "test without poketrace" },
    );
    expect(createSlabPricingFromEnv({ VITEST: "true" }).slabPricing.name).toBe("off");
  });

  it("selects poketrace outside tests when the flag and key are set", () => {
    expect(
      resolveSlabPricingSelection({
        NODE_ENV: "production",
        CARD_FLOW_POKETRACE_ENABLED: "true",
        POKETRACE_API_KEY: "pt-test",
      }),
    ).toMatchObject({ kind: "poketrace" });
    expect(
      resolveSlabPricingSelection({
        NODE_ENV: "production",
        CARD_FLOW_POKETRACE_ENABLED: "true",
      }),
    ).toMatchObject({ kind: "off", reason: "poketrace_enabled=true without API key" });
    expect(
      createSlabPricingFromEnv({
        NODE_ENV: "production",
        CARD_FLOW_POKETRACE_ENABLED: "true",
      }).slabPricing.name,
    ).toBe("off");
  });

  it("returns empty Prepare rows when the key is missing, never mock dollars", async () => {
    const estimate = await createSlabPricingFromEnv({
      NODE_ENV: "production",
      CARD_FLOW_POKETRACE_ENABLED: "true",
    }).slabPricing.getSlabEstimates({
      tcgdexId: "base1-58",
      name: "Pikachu",
      localId: "58",
    });
    expect(estimate).toEqual(emptySlabEstimate("base1-58"));
    expect(estimate.rows.find((row) => row.company === "PSA" && row.grade === "10")?.amount).toBeNull();
  });
});

describe("PokeTrace URL helpers", () => {
  it("normalizes host-only env to the public v1 endpoint", () => {
    expect(normalizePoketraceBaseUrl(undefined)).toBe("https://api.poketrace.com/v1");
    expect(normalizePoketraceBaseUrl("api.poketrace.com")).toBe("https://api.poketrace.com/v1");
    expect(normalizePoketraceBaseUrl("https://api.poketrace.com")).toBe("https://api.poketrace.com/v1");
    expect(normalizePoketraceBaseUrl("https://api.poketrace.com/v1/")).toBe(
      "https://api.poketrace.com/v1",
    );
    expect(joinPoketraceUrl("api.poketrace.com", "/cards?search=Pikachu")).toBe(
      "https://api.poketrace.com/v1/cards?search=Pikachu",
    );
  });

  it("matches padded PokeTrace numbers and only slugs human set names", () => {
    expect(normalizePoketraceCardNumber("058/102")).toBe("58");
    expect(poketraceCardNumberMatches("058/102", "58")).toBe(true);
    expect(poketraceSetSlug("Base Set")).toBe("base-set");
    expect(poketraceSetSlug("base1")).toBeUndefined();
  });
});

describe("PokeTrace HTTP adapter", () => {
  const pikachuList = {
    data: [
      {
        id: "pt-pikachu",
        name: "Pikachu",
        cardNumber: "058/102",
        set: { slug: "base-set", name: "Base Set" },
        prices: { ebay: { PSA_10: { avg: 120 }, PSA_9: { avg: 55 } } },
      },
    ],
  };

  it("searches live /cards and maps graded prices without leaking the key", async () => {
    const urls: string[] = [];
    const provider = createPoketraceSlabProvider({
      apiKey: "pt-secret",
      baseUrl: "api.poketrace.com",
      async fetchImpl(input, init) {
        const url = String(input);
        urls.push(url);
        expect(new Headers(init?.headers).get("x-api-key")).toBe("pt-secret");
        expect(url).toContain("/cards?");
        expect(url).toContain("search=Pikachu");
        expect(url).toContain("set=base-set");
        expect(url).toContain("game=pokemon");
        expect(url).not.toContain("graded-prices");
        expect(url).not.toContain("pt-secret");
        return new Response(JSON.stringify(pikachuList), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const estimate = await provider.getSlabEstimates({
      tcgdexId: "base1-58",
      name: "Pikachu",
      localId: "58",
      setName: "Base Set",
    });
    expect(estimate.source).toBe("poketrace");
    expect(estimate.rows.find((row) => row.company === "PSA" && row.grade === "10")?.amount).toBe(
      "120.00",
    );
    expect(JSON.stringify(estimate)).not.toMatch(/pt-secret|POKETRACE_/);
    expect(urls).toHaveLength(1);
  });

  it("keeps Free-plan raw prices and reads graded summary from card detail, not history", async () => {
    const urls: string[] = [];
    const provider = createPoketraceSlabProvider({
      apiKey: "pt-secret",
      async fetchImpl(input) {
        const url = String(input);
        urls.push(url);
        expect(url).not.toContain("/prices/");
        if (url.includes("/cards/pt-pikachu")) {
          return new Response(
            JSON.stringify({
              data: {
                id: "pt-pikachu",
                topPrice: 3246.39,
                gradedOptions: ["PSA_10", "PSA_9", "BGS_9_5", "SGC_10"],
                prices: {
                  ebay: { NEAR_MINT: { avg: 12 }, LIGHTLY_PLAYED: { avg: 8 } },
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "pt-pikachu",
                name: "Pikachu",
                cardNumber: "058/102",
                set: { slug: "base-set", name: "Base Set" },
                prices: {
                  ebay: { NEAR_MINT: { avg: 12 }, LIGHTLY_PLAYED: { avg: 8 } },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const estimate = await provider.getSlabEstimates({
      tcgdexId: "base1-58",
      name: "Pikachu",
      localId: "58",
    });
    expect(estimate.source).toBe("poketrace");
    expect(estimate.rawRows.find((row) => row.condition === "NM")?.amount).toBe("12.00");
    expect(estimate.rawRows.find((row) => row.condition === "LP")?.amount).toBe("8.00");
    expect(estimate.rows.every((row) => row.amountCents === null)).toBe(true);
    expect(estimate.topAmount).toBe("3246.39");
    expect(estimate.gradedTiers).toEqual([
      { company: "PSA", grade: "10" },
      { company: "PSA", grade: "9" },
      { company: "BGS", grade: "9.5" },
    ]);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("/cards/pt-pikachu");
  });

  it("loads card detail when the list payload has no usable prices", async () => {
    const provider = createPoketraceSlabProvider({
      apiKey: "pt-secret",
      async fetchImpl(input) {
        const url = String(input);
        expect(url).not.toContain("/prices/");
        if (url.includes("/cards?")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "pt-pikachu",
                  name: "Pikachu",
                  cardNumber: "058/102",
                  set: { slug: "base-set", name: "Base Set" },
                  prices: { ebay: { NEAR_MINT: { avg: 0 } } },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        expect(url).toContain("/cards/pt-pikachu");
        return new Response(
          JSON.stringify({
            data: {
              id: "pt-pikachu",
              prices: { ebay: { NEAR_MINT: { avg: 12 }, LIGHTLY_PLAYED: { avg: 8 } } },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const estimate = await provider.getSlabEstimates({
      tcgdexId: "base1-58",
      name: "Pikachu",
      localId: "58",
    });
    expect(estimate.source).toBe("poketrace");
    expect(estimate.rawRows.find((row) => row.condition === "NM")?.amount).toBe("12.00");
    expect(estimate.rawRows.find((row) => row.condition === "LP")?.amount).toBe("8.00");
  });

  it("resolves a numeric set name through PokeTrace sets when the first page misses the number", async () => {
    const urls: string[] = [];
    const provider = createPoketraceSlabProvider({
      apiKey: "pt-secret",
      async fetchImpl(input) {
        const url = String(input);
        urls.push(url);
        expect(url).not.toContain("/prices/");
        if (url.includes("/sets?")) {
          return new Response(
            JSON.stringify({
              data: [
                { slug: "151", name: "151" },
                { slug: "sv-scarlet-and-violet-151", name: "SV: Scarlet & Violet 151" },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("set=sv-scarlet-and-violet-151")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "pt-squirtle",
                  name: "Squirtle",
                  cardNumber: "007/165",
                  prices: { ebay: { NEAR_MINT: { avg: 1 } } },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/cards/pt-squirtle")) {
          return new Response(
            JSON.stringify({
              data: {
                id: "pt-squirtle",
                topPrice: 40.5,
                gradedOptions: ["PSA_10", "TAG_10"],
                prices: { ebay: { NEAR_MINT: { avg: 1 } } },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "pt-other",
                name: "Squirtle",
                cardNumber: "063/102",
                prices: { ebay: { NEAR_MINT: { avg: 2 } } },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const estimate = await provider.getSlabEstimates({
      tcgdexId: "sv03.5-007",
      name: "Squirtle",
      localId: "007",
      setName: "151",
    });
    expect(estimate.topAmount).toBe("40.50");
    expect(estimate.gradedTiers).toEqual([
      { company: "PSA", grade: "10" },
      { company: "TAG", grade: "10" },
    ]);
    expect(urls.some((url) => url.includes("set=sv-scarlet-and-violet-151"))).toBe(true);
    expect(urls.some((url) => url.includes("set=151"))).toBe(false);
  });

  it("returns empty rows on HTTP failure or missing catalog name", async () => {
    const failing = createPoketraceSlabProvider({
      apiKey: "pt-secret",
      async fetchImpl() {
        return new Response("nope", { status: 500 });
      },
    });
    expect(
      await failing.getSlabEstimates({ tcgdexId: "base1-58", name: "Pikachu", localId: "58" }),
    ).toEqual(emptySlabEstimate("base1-58"));
    expect(await failing.getSlabEstimates({ tcgdexId: "base1-58" })).toEqual(
      emptySlabEstimate("base1-58"),
    );

    const upgrade = createPoketraceSlabProvider({
      apiKey: "pt-secret",
      async fetchImpl() {
        return new Response(JSON.stringify({ code: "UPGRADE_REQUIRED" }), { status: 403 });
      },
    });
    expect(
      await upgrade.getSlabEstimates({ tcgdexId: "base1-58", name: "Pikachu", localId: "58" }),
    ).toEqual(emptySlabEstimate("base1-58"));
    expect(createMockSlabPricingProvider().name).toBe("mock");
  });
});
