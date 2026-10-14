import { describe, expect, it } from "vitest";
import {
  catalogHealth,
  GRADE_ENGINE_STILL_RUNNING,
  gradeEstimateHealth,
  healthLeaksSecrets,
  healthMockProviders,
  healthOk,
  livestreamIdentifyHealth,
  pricingProviderHealth,
  recognitionHealth,
  slabPricingHealth,
} from "./health";

describe("CardFlow /health status", () => {
  it("maps stack names to honest unions and never CardSight", () => {
    expect(catalogHealth("mock")).toBe("mock");
    expect(catalogHealth("tcgdex")).toBe("tcgdex");
    expect(catalogHealth("pokecollector")).toBe("pokecollector");
    expect(catalogHealth("unknown")).toBe("mock");

    expect(recognitionHealth("mock")).toBe("mock");
    expect(recognitionHealth("obb_phash")).toBe("obb_phash");
    expect(recognitionHealth("cardsight")).toBe("mock");

    expect(pricingProviderHealth("off")).toBe("off");
    expect(pricingProviderHealth("mock")).toBe("off");
    expect(pricingProviderHealth("pokecollector")).toBe("pokecollector");

    expect(livestreamIdentifyHealth("yolo_identity")).toBe("yolo_identity");
    expect(livestreamIdentifyHealth("off")).toBe("off");
    expect(livestreamIdentifyHealth(undefined)).toBe("off");

    expect(gradeEstimateHealth("mock")).toBe("mock");
    expect(gradeEstimateHealth("off")).toBe("off");
    expect(gradeEstimateHealth("cardgrading")).toBe("cardgrading");
    expect(gradeEstimateHealth("vision")).toBe("mock");
    expect(gradeEstimateHealth("cnn")).toBe("cnn");
    expect(gradeEstimateHealth("anthropic")).toBe("mock");
    expect(gradeEstimateHealth("psagradepredictor")).toBe("mock");

    expect(slabPricingHealth("off")).toBe("off");
    expect(slabPricingHealth("mock")).toBe("mock");
    expect(slabPricingHealth("poketrace")).toBe("poketrace");
    expect(slabPricingHealth("unknown")).toBe("off");
  });

  it("marks the stack mock when any provider is still a fixture", () => {
    expect(
      healthMockProviders({
        catalog: "pokecollector",
        recognition: "mock",
        gradeEstimate: "off",
        slabPricing: "off",
      }),
    ).toEqual(["recognition"]);
    expect(
      healthMockProviders({
        catalog: "pokecollector",
        recognition: "obb_phash",
        gradeEstimate: "mock",
        slabPricing: "off",
      }),
    ).toEqual(["gradeEstimate"]);
    expect(
      healthMockProviders({
        catalog: "mock",
        recognition: "mock",
        gradeEstimate: "mock",
        slabPricing: "mock",
      }),
    ).toEqual(["catalog", "recognition", "gradeEstimate", "slabPricing"]);
    expect(
      healthMockProviders({
        catalog: "pokecollector",
        recognition: "obb_phash",
        gradeEstimate: "cardgrading",
        slabPricing: "poketrace",
      }),
    ).toEqual([]);
    expect(
      healthMockProviders({
        catalog: "tcgdex",
        recognition: "obb_phash",
        gradeEstimate: "off",
        slabPricing: "off",
      }),
    ).toEqual([]);
  });

  it("treats a failed grader probe as not ok and a pending probe as ok", () => {
    expect(healthOk(null)).toBe(true);
    expect(
      healthOk({
        ok: true,
        opencv: "4.10.0",
        numpy: "2.2.0",
        error: null,
        checkedAt: "2026-10-13T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      healthOk({
        ok: false,
        opencv: null,
        numpy: null,
        error: GRADE_ENGINE_STILL_RUNNING,
        checkedAt: "2026-10-13T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      healthOk({
        ok: false,
        opencv: null,
        numpy: null,
        error: "cv2 missing",
        checkedAt: "2026-10-13T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("does not serialize keys or vendor secrets", () => {
    expect(
      healthLeaksSecrets({
        ok: true,
        catalog: "mock",
        recognition: "mock",
        pricingProvider: "off",
        livestreamIdentify: "yolo_identity",
        gradeEstimate: "mock",
        slabPricing: "off",
      }),
    ).toBe(false);
    expect(healthLeaksSecrets({ apiKey: "secret" })).toBe(true);
    expect(healthLeaksSecrets({ cardsight: true })).toBe(true);
    expect(healthLeaksSecrets({ ANTHROPIC_API_KEY: "sk-test" })).toBe(true);
    expect(healthLeaksSecrets({ XAI_API_KEY: "xai-test" })).toBe(true);
    expect(healthLeaksSecrets({ POKETRACE_API_KEY: "pt-test" })).toBe(true);
  });
});
