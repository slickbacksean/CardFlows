import { describe, expect, it } from "vitest";
import {
  healthLeaksSecrets,
  mockCardRecognitionProvider,
  createOffCardGradingProvider,
  createMockSlabPricingProvider,
  emptyGradeEstimate,
  emptyPriceEstimate,
  emptySlabEstimate,
  offSlabPricingProvider,
  type CardCatalogProvider,
  type CardPricingProvider,
  type CardRecognitionProvider,
  type SlabPricingProvider,
} from "@cardflow/shared";
import { identifyCardMock } from "@cardflow/shared/mock";
import { createApp } from "./app";
import { createMemoryStore } from "./store";

type App = ReturnType<typeof createApp>;

async function json<T>(app: App, pathName: string) {
  const response = await app.request(pathName);
  return { status: response.status, body: (await response.json()) as T };
}

function namedRecognition(name: CardRecognitionProvider["name"]): CardRecognitionProvider {
  return {
    name,
    async identifyCard(req) {
      return mockCardRecognitionProvider.identifyCard(req);
    },
  };
}

const liveCatalog = { name: "pokecollector" } as CardCatalogProvider;

const livePricing: CardPricingProvider = {
  name: "pokecollector",
  async getEstimate(req) {
    return emptyPriceEstimate(req.tcgdexId);
  },
};

const liveSlab: SlabPricingProvider = {
  name: "poketrace",
  async getSlabEstimates(req) {
    return emptySlabEstimate(req.tcgdexId, "poketrace");
  },
};

describe("GET /health", () => {
  it("reports catalog, recognition, pricing, and livestream identify without keys", async () => {
    const health = await json<Record<string, unknown>>(createApp(createMemoryStore()), "/health");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({
      ok: true,
      service: "cardflow-api",
      mock: true,
      mockProviders: ["catalog", "recognition", "gradeEstimate"],
      catalog: "mock",
      recognition: "mock",
      pricingProvider: "off",
      livestreamIdentify: "yolo_identity",
      liveIdentityVisual: "off",
      gradeEstimate: "mock",
      gradeEngine: null,
      slabPricing: "off",
    });
    expect(health.body.slabPricing).toBe("off");
    expect(healthLeaksSecrets(health.body)).toBe(false);
    expect(JSON.stringify(health.body)).not.toMatch(/api[_ -]?key/i);
    expect(JSON.stringify(health.body)).not.toMatch(/cardsight/i);
    expect(JSON.stringify(health.body)).not.toContain("CARDSIGHT_");
  });

  it("never reports CardSight on recognition and can report obb_phash or livestream off", async () => {
    const cardsight = await json<{ recognition: string }>(
      createApp(createMemoryStore(), {
        recognition: {
          name: "cardsight",
          async identifyCard() {
            return { ...identifyCardMock("high-confidence"), provider: "cardsight", _meta: undefined };
          },
        },
      }),
      "/health",
    );
    expect(cardsight.body.recognition).toBe("mock");

    const obb = await json<{ recognition: string }>(
      createApp(createMemoryStore(), { recognition: namedRecognition("obb_phash") }),
      "/health",
    );
    expect(obb.body.recognition).toBe("obb_phash");

    const livestreamOff = await json<{ livestreamIdentify: string }>(
      createApp(createMemoryStore(), { livestreamIdentify: "off" }),
      "/health",
    );
    expect(livestreamOff.body.livestreamIdentify).toBe("off");
  });

  it("reports liveIdentityVisual as openclip, phash, or off without a token", async () => {
    const phash = await json<{ liveIdentityVisual: string }>(
      createApp(createMemoryStore(), {
        livestreamIdentityIndex: {
          language: "en",
          entries: [{ tcgdexId: "base1-58", hash: "0000000000000000" }],
        },
      }),
      "/health",
    );
    expect(phash.body.liveIdentityVisual).toBe("phash");

    const openclip = await json<{ liveIdentityVisual: string }>(
      createApp(createMemoryStore(), {
        livestreamIdentityIndex: {
          language: "en",
          entries: [{ tcgdexId: "base1-58", hash: "0000000000000000" }],
        },
        liveIdentityOpenclip: {
          name: "openclip_hnsw",
          async matchCropJpeg() {
            return null;
          },
        },
      }),
      "/health",
    );
    expect(openclip.body.liveIdentityVisual).toBe("openclip");
    expect(JSON.stringify(openclip.body)).not.toMatch(/8092|token|Bearer/i);

    const off = await json<{ liveIdentityVisual: string }>(
      createApp(createMemoryStore(), { livestreamIdentify: "off" }),
      "/health",
    );
    expect(off.body.liveIdentityVisual).toBe("off");
  });

  it("reports gradeEstimate off, cardgrading, or cnn without keys", async () => {
    const off = await json<{ gradeEstimate: string }>(
      createApp(createMemoryStore(), { grading: createOffCardGradingProvider() }),
      "/health",
    );
    expect(off.body.gradeEstimate).toBe("off");

    const cardgrading = await json<{ gradeEstimate: string }>(
      createApp(createMemoryStore(), {
        grading: {
          name: "cardgrading",
          async estimateGrade() {
            return emptyGradeEstimate();
          },
        },
      }),
      "/health",
    );
    expect(cardgrading.body.gradeEstimate).toBe("cardgrading");

    const cnn = await json<{ gradeEstimate: string }>(
      createApp(createMemoryStore(), {
        grading: {
          name: "cnn",
          async estimateGrade() {
            return emptyGradeEstimate();
          },
        },
      }),
      "/health",
    );
    expect(cnn.body.gradeEstimate).toBe("cnn");
    expect(JSON.stringify(cnn.body)).not.toMatch(/ANTHROPIC_|XAI_|POKETRACE_|PSA_GRADE/);
  });

  it("sets mock when recognition is off or the grade is still a fixture", async () => {
    const recognitionOff = await json<{ mock: boolean; mockProviders: string[] }>(
      createApp(createMemoryStore(), {
        catalog: liveCatalog,
        recognition: namedRecognition("mock"),
        grading: createOffCardGradingProvider(),
      }),
      "/health",
    );
    expect(recognitionOff.body.mock).toBe(true);
    expect(recognitionOff.body.mockProviders).toEqual(["recognition"]);

    const mockGrade = await json<{ mock: boolean; mockProviders: string[] }>(
      createApp(createMemoryStore(), {
        catalog: liveCatalog,
        recognition: namedRecognition("obb_phash"),
        grading: {
          name: "mock",
          async estimateGrade() {
            return emptyGradeEstimate();
          },
        },
        slabPricing: offSlabPricingProvider,
      }),
      "/health",
    );
    expect(mockGrade.body.mock).toBe(true);
    expect(mockGrade.body.mockProviders).toContain("gradeEstimate");
    expect(mockGrade.body.mockProviders).not.toContain("recognition");

    const slabMock = await json<{ mock: boolean; mockProviders: string[] }>(
      createApp(createMemoryStore(), {
        catalog: liveCatalog,
        recognition: namedRecognition("obb_phash"),
        grading: createOffCardGradingProvider(),
        slabPricing: createMockSlabPricingProvider(),
      }),
      "/health",
    );
    expect(slabMock.body.mock).toBe(true);
    expect(slabMock.body.mockProviders).toEqual(["slabPricing"]);
  });

  it("can report a fully live stack as mock false without secrets", async () => {
    const health = await json<Record<string, unknown>>(
      createApp(createMemoryStore(), {
        catalog: liveCatalog,
        recognition: namedRecognition("obb_phash"),
        pricing: livePricing,
        livestreamIdentify: "yolo_identity",
        grading: {
          name: "cardgrading",
          async estimateGrade() {
            return emptyGradeEstimate();
          },
        },
        slabPricing: liveSlab,
      }),
      "/health",
    );
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      mock: false,
      mockProviders: [],
      catalog: "pokecollector",
      recognition: "obb_phash",
      pricingProvider: "pokecollector",
      gradeEstimate: "cardgrading",
      slabPricing: "poketrace",
    });
    expect(healthLeaksSecrets(health.body)).toBe(false);
    expect(JSON.stringify(health.body)).not.toMatch(/api[_ -]?key|ANTHROPIC_|XAI_|POKETRACE_|Bearer/i);
  });
});
