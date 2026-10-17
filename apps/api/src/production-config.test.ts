import { describe, expect, it } from "vitest";
import { assertProductionConfig, productionConfigProblems } from "./production-config";

describe("H3 production config", () => {
  it("refuses production without CARD_FLOW_TRUST_PROXY_HOPS", () => {
    expect(() => assertProductionConfig({ NODE_ENV: "production" })).toThrow(/CARD_FLOW_TRUST_PROXY_HOPS/);
    expect(() => assertProductionConfig({ NODE_ENV: "production", CARD_FLOW_TRUST_PROXY_HOPS: "abc" })).toThrow();
  });
  it("Backend re-review L3: refuses production without a 32+ character CARD_FLOW_SERVER_PEPPER", () => {
    expect(productionConfigProblems({ NODE_ENV: "production", CARD_FLOW_TRUST_PROXY_HOPS: "0" }).join(" ")).toMatch(/CARD_FLOW_SERVER_PEPPER/);
    expect(productionConfigProblems({ NODE_ENV: "production", CARD_FLOW_TRUST_PROXY_HOPS: "0", CARD_FLOW_SERVER_PEPPER: "short" })).toHaveLength(1);
  });
  it("accepts an explicit value, including 0, and ignores development", () => {
    const pepper = { CARD_FLOW_SERVER_PEPPER: "p".repeat(32) };
    expect(productionConfigProblems({ NODE_ENV: "production", CARD_FLOW_TRUST_PROXY_HOPS: "0", ...pepper })).toEqual([]);
    expect(productionConfigProblems({ NODE_ENV: "production", CARD_FLOW_TRUST_PROXY_HOPS: "1", ...pepper })).toEqual([]);
    expect(productionConfigProblems({ NODE_ENV: "development" })).toEqual([]);
  });
});
