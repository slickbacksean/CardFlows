/** Settings §10a. Live continuous ID is a non-goal; not `cardsight_recognition`. */
export const SETTINGS_RESEARCH_FLAG_IDS = [
  "live_identification_research",
  "live_browser_research",
  "auto_scan_research",
  "pricing_provider_enabled",
  "marketplace_automation",
] as const;

export type SettingsResearchFlagId = (typeof SETTINGS_RESEARCH_FLAG_IDS)[number];

export const FEATURE_FLAG_DEFAULTS = {
  live_identification_research: false,
  live_browser_research: false,
  auto_scan_research: false,
  pricing_provider_enabled: false,
  marketplace_automation: false,
} as const satisfies Record<SettingsResearchFlagId, false>;

export const SETTINGS_RESEARCH_FLAG_LABELS = {
  live_identification_research: "Live identification",
  live_browser_research: "In-app marketplace browser",
  auto_scan_research: "Auto-scan",
  pricing_provider_enabled: "Pricing provider",
  marketplace_automation: "Marketplace automation",
} as const satisfies Record<SettingsResearchFlagId, string>;

/** Locked-off rows in Settings. Overlay/livestream/pricing status comes from /health. */
export const SETTINGS_LOCKED_OFF_FLAG_IDS = [
  "auto_scan_research",
  "marketplace_automation",
] as const satisfies ReadonlyArray<SettingsResearchFlagId>;

export const MARKETPLACE_AUTOMATION_NO_ENABLE_COPY =
  "Marketplace automation stays off. There is no in-app path to turn it on.";

export function featureFlagStateLabel(enabled: boolean): "ON" | "OFF" {
  return enabled ? "ON" : "OFF";
}

export const SETTINGS_RESEARCH_FLAGS = SETTINGS_LOCKED_OFF_FLAG_IDS.map((id) => ({
  id,
  label: SETTINGS_RESEARCH_FLAG_LABELS[id],
  enabled: FEATURE_FLAG_DEFAULTS[id],
}));
