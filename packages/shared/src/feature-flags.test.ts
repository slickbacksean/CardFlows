import { describe, expect, it } from "vitest";
import {
  FEATURE_FLAG_DEFAULTS,
  MARKETPLACE_AUTOMATION_NO_ENABLE_COPY,
  SETTINGS_RESEARCH_FLAG_IDS,
  SETTINGS_RESEARCH_FLAGS,
  featureFlagStateLabel,
} from "./feature-flags";

describe("Settings research flags", () => {
  it("uses MVP_SCOPE names and default OFF", () => {
    expect(SETTINGS_RESEARCH_FLAG_IDS).toEqual([
      "live_identification_research",
      "live_browser_research",
      "auto_scan_research",
      "pricing_provider_enabled",
      "marketplace_automation",
    ]);
    expect(SETTINGS_RESEARCH_FLAGS.map((flag) => flag.label)).toEqual([
      "Auto-scan",
      "Marketplace automation",
    ]);
    for (const id of SETTINGS_RESEARCH_FLAG_IDS) {
      expect(FEATURE_FLAG_DEFAULTS[id]).toBe(false);
    }
    for (const flag of SETTINGS_RESEARCH_FLAGS) {
      expect(flag.enabled).toBe(false);
      expect(featureFlagStateLabel(flag.enabled)).toBe("OFF");
    }
  });

  it("has no in-app path to enable marketplace automation", () => {
    const marketplaceAutomation: false = FEATURE_FLAG_DEFAULTS.marketplace_automation;
    expect(marketplaceAutomation).toBe(false);
    expect(MARKETPLACE_AUTOMATION_NO_ENABLE_COPY).toContain("no in-app path");
    expect(featureFlagStateLabel(marketplaceAutomation)).toBe("OFF");
  });
});
