import { describe, expect, it } from "vitest";
import { offPricingProvider } from "@cardflow/shared";
import { createPricingFromEnv, pricingEnabledFromEnv } from "./pokecollector-env";

const live = { CARD_FLOW_POKECOLLECTOR_URL: "http://127.0.0.1:8000", CARD_FLOW_POKECOLLECTOR_ENABLED: "true" };

describe("CARD_FLOW_PRICING_ENABLED server gate", () => {
  it("defaults to on (Sean's decision) when unset or empty", () => {
    expect(pricingEnabledFromEnv({})).toBe(true);
    expect(pricingEnabledFromEnv({ CARD_FLOW_PRICING_ENABLED: "" })).toBe(true);
    expect(pricingEnabledFromEnv({ CARD_FLOW_PRICING_ENABLED: "true" })).toBe(true);
    const { pricing, selection } = createPricingFromEnv(live);
    expect(pricing).not.toBe(offPricingProvider);
    expect(selection.kind).toBe("pokecollector");
  });

  it("turns pricing off even when PokéCollector is configured", () => {
    for (const value of ["false", "FALSE", "0", "off"]) {
      const { pricing, selection } = createPricingFromEnv({ ...live, CARD_FLOW_PRICING_ENABLED: value });
      expect(pricing).toBe(offPricingProvider);
      expect(selection.kind).toBe("off");
      expect(selection.reason).toBe("CARD_FLOW_PRICING_ENABLED=false");
    }
  });
});
