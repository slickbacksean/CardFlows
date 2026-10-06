import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FEATURE_FLAG_DEFAULTS } from "./feature-flags";
import {
  DEFAULT_INVITED_IDENTITY,
  DEFAULT_INVITED_USER_ID,
} from "./identity";
import { GRADE_ESTIMATE_ENABLED_FLAG } from "./grade-estimate";
import {
  SETTINGS_JOBS,
  SETTINGS_KICKER,
  SETTINGS_STACK_STATUS_CHECKING,
  SETTINGS_STACK_STATUS_ROWS,
  SETTINGS_STACK_STATUS_UNAVAILABLE,
  forbiddenSettingsHardNo,
  forbiddenSettingsLiveVendorConfig,
  settingsJobLabel,
  settingsKickerForIdentity,
  settingsStackStatusValue,
  settingsVisibleCopy,
} from "./settings";
import type { CardFlowHealth } from "./health";

function readSettingsScreen(): string {
  return readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/mobile/app/settings.tsx"),
    "utf8",
  );
}

describe("Settings hard no's", () => {
  it("only links Max Buy rules and About", () => {
    expect(SETTINGS_JOBS.map((job) => job.id)).toEqual(["max_buy_rules", "about"]);
    expect(settingsJobLabel("max_buy_rules")).toBe("Max Buy rules");
    expect(settingsJobLabel("about")).toBe("About CardFlow");
  });

  it("cannot start marketplace automation or a paywall from Settings", () => {
    const marketplaceAutomation: false = FEATURE_FLAG_DEFAULTS.marketplace_automation;
    expect(marketplaceAutomation).toBe(false);
    expect(forbiddenSettingsHardNo(settingsVisibleCopy())).toBeNull();
    expect(forbiddenSettingsHardNo("AI grading paywall")).toBe("ai_grading");

    const screen = readSettingsScreen();
    expect(forbiddenSettingsHardNo(screen)).toBeNull();
    expect(screen).not.toMatch(/<Switch[\s/>]/);
    expect(screen).not.toContain('accessibilityRole="switch"');
    expect(screen).not.toContain("TextInput");
    expect(screen).not.toMatch(/AI grading/i);
    expect(screen).not.toMatch(/anthropic|poketrace|ANTHROPIC_|POKETRACE_/i);
    expect(screen).toContain("getHealth()");
    expect(screen).toContain("SETTINGS_STACK_STATUS_ROWS");
    expect(screen).toContain("stackLoad");
    expect(SETTINGS_STACK_STATUS_ROWS.map((row) => row.id)).toEqual([
      "catalog",
      "recognition",
      "livestreamIdentify",
      "liveIdentityVisual",
      "pricingProvider",
      "gradeEstimate",
      "slabPricing",
    ]);
    expect(GRADE_ESTIMATE_ENABLED_FLAG in FEATURE_FLAG_DEFAULTS).toBe(false);
    expect(SETTINGS_JOBS.map((job) => job.id)).not.toContain("grade_estimate");
  });

  it("has no live-vendor configuration", () => {
    const pricingProviderEnabled: false = FEATURE_FLAG_DEFAULTS.pricing_provider_enabled;
    expect(pricingProviderEnabled).toBe(false);
    expect(forbiddenSettingsLiveVendorConfig(settingsVisibleCopy())).toBeNull();

    const screen = readSettingsScreen();
    expect(forbiddenSettingsLiveVendorConfig(screen)).toBeNull();
    expect(forbiddenSettingsLiveVendorConfig("CardSight API key")).toBe("api_key");
    expect(
      forbiddenSettingsLiveVendorConfig("self-host tcgdex/server docker-compose"),
    ).toBe("tcgdex_self_host_runbook");
    expect(forbiddenSettingsLiveVendorConfig("pricing_endpoint variants_detailed")).toBe(
      "pricing_provider_fields",
    );
    expect(forbiddenSettingsLiveVendorConfig("Anthropic Claude")).toBe("anthropic");
    expect(forbiddenSettingsLiveVendorConfig("PokeTrace graded prices")).toBe("poketrace");
  });
});

describe("Settings stack labels", () => {
  const liveHealth: CardFlowHealth = {
    ok: true,
    service: "cardflow-api",
    mock: false,
    mockProviders: [],
    catalog: "pokecollector",
    recognition: "obb_phash",
    pricingProvider: "pokecollector",
    livestreamIdentify: "yolo_identity",
    liveIdentityVisual: "openclip",
    gradeEstimate: "cardgrading",
    slabPricing: "poketrace",
  };

  it("shows Checking… until health loads, then readable labels", () => {
    expect(settingsStackStatusValue(null, "recognition", "checking")).toBe(
      SETTINGS_STACK_STATUS_CHECKING,
    );
    expect(settingsStackStatusValue(null, "gradeEstimate", "unavailable")).toBe(
      SETTINGS_STACK_STATUS_UNAVAILABLE,
    );
    expect(settingsStackStatusValue(liveHealth, "recognition")).toBe("Photo match");
    expect(settingsStackStatusValue(liveHealth, "gradeEstimate")).toBe("Offline photo grader");
    expect(settingsStackStatusValue(liveHealth, "slabPricing")).toBe("Live comps");
    expect(settingsStackStatusValue(liveHealth, "livestreamIdentify")).toBe("Live video");
    expect(settingsStackStatusValue(liveHealth, "liveIdentityVisual")).toBe("OpenCLIP");
    expect(settingsStackStatusValue(liveHealth, "catalog")).toBe("PokéCollector");
    expect(settingsVisibleCopy()).toContain("Grade estimate");
    expect(settingsVisibleCopy()).toContain("Slab comps");
    expect(forbiddenSettingsLiveVendorConfig(settingsVisibleCopy())).toBeNull();
  });
});

describe("Settings shows who is signed in", () => {
  it("uses the active invited label and falls back when unsigned", () => {
    expect(settingsKickerForIdentity(DEFAULT_INVITED_IDENTITY)).toBe(
      DEFAULT_INVITED_IDENTITY.label,
    );
    expect(settingsKickerForIdentity(null)).toBe(SETTINGS_KICKER);
    expect(DEFAULT_INVITED_IDENTITY.userId).toBe(DEFAULT_INVITED_USER_ID);
  });

  it("loads the current identity into the Settings kicker", () => {
    const screen = readSettingsScreen();
    const identity = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/mobile/lib/identity.ts"),
      "utf8",
    );
    const api = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/mobile/lib/api.ts"),
      "utf8",
    );

    expect(screen).toContain("useState(SETTINGS_KICKER)");
    expect(screen).toContain("loadIdentitySession()");
    expect(screen).toContain("setKicker(settingsKickerForIdentity(session.identity))");
    expect(screen).toContain("setKicker(SETTINGS_KICKER)");
    expect(screen).not.toMatch(/ImagePicker|launchImageLibrary|avatar photo|Connect eBay/i);
    expect(identity).toContain("getIdentity()");
    expect(api).toContain('"/v1/identity"');
  });
});
