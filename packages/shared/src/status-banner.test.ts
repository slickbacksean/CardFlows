import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STATUS_BANNER_COPY, statusBanners } from "./status-banner";

describe("P1-21 status banners", () => {
  it("shows pricing delayed when the pricing flag is off and clears when healthy", () => {
    expect(statusBanners({ pricingProvider: "off", gradeEstimate: "cardgrading", gradeEngineOk: true }).map((b) => b.id)).toEqual(["pricing_delayed"]);
    expect(statusBanners({ pricingProvider: "pokecollector", gradeEstimate: "cardgrading", gradeEngineOk: true })).toEqual([]);
    expect(statusBanners({ pricingProvider: "pokecollector", pricingUnhealthy: true, gradeEstimate: "mock", gradeEngineOk: null })[0]?.id).toBe("pricing_delayed");
  });
  it("covers the grader and an operator note", () => {
    const ids = statusBanners({ pricingProvider: "pokecollector", gradeEstimate: "cardgrading", gradeEngineOk: false, opsMessage: "  Maintenance at 9 PM PT  " });
    expect(ids.map((b) => b.id)).toEqual(["pregrade_unavailable", "ops_notice"]);
    expect(ids[1]?.message).toBe("Maintenance at 9 PM PT");
  });
  it("copy never names a grader or says AI, and the phone polls the server", () => {
    for (const copy of Object.values(STATUS_BANNER_COPY)) expect(copy).not.toMatch(/\bAI\b|PSA|BGS|CGC/);
    const banner = readFileSync(resolve(__dirname, "../../../apps/mobile/components/ui/status-banner.tsx"), "utf8");
    expect(banner).toContain("getStatus");
    expect(banner).toContain("STATUS_POLL_MS");
  });
});
