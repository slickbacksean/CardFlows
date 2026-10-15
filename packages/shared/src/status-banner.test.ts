import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STATUS_BANNER_COPY, statusBanners, statusCopyViolations } from "./status-banner";

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

  it("drops an operator note that breaks the copy rule", () => {
    const base = { pricingProvider: "pokecollector", gradeEstimate: "cardgrading", gradeEngineOk: true } as const;
    for (const bad of ["New AI grading is live", "PSA 10 odds look great", "BGS and CGC pricing back", "Guaranteed profit on every flip", "Earn $50 per card"]) {
      expect(statusCopyViolations(bad).length).toBeGreaterThan(0);
      expect(statusBanners({ ...base, opsMessage: bad })).toEqual([]);
    }
    expect(statusBanners({ ...base, opsMessage: "Maintenance at 9 PM PT" })).toHaveLength(1);
    for (const copy of Object.values(STATUS_BANNER_COPY)) expect(statusCopyViolations(copy)).toEqual([]);
  });
});
