import { describe, expect, it } from "vitest";
import { assertProductionConfig, productionConfigProblems } from "./production-config";

describe("H3 production config", () => {
  it("refuses production without CARD_FLOW_TRUST_PROXY_HOPS", () => {
    expect(() => assertProductionConfig({ NODE_ENV: "production" })).toThrow(/CARD_FLOW_TRUST_PROXY_HOPS/);
    expect(() => assertProductionConfig({ NODE_ENV: "production", CARD_FLOW_TRUST_PROXY_HOPS: "abc" })).toThrow();
  });
  it("accepts an explicit value, including 0, and ignores development", () => {
    expect(productionConfigProblems({ NODE_ENV: "production", CARD_FLOW_TRUST_PROXY_HOPS: "0" })).toEqual([]);
    expect(productionConfigProblems({ NODE_ENV: "production", CARD_FLOW_TRUST_PROXY_HOPS: "1" })).toEqual([]);
    expect(productionConfigProblems({ NODE_ENV: "development" })).toEqual([]);
  });
});
