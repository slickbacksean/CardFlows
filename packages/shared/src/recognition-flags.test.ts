import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FEATURE_FLAG_DEFAULTS } from "./feature-flags";
import {
  CARDSIGHT_IDENTIFY_ENABLED_FLAG,
  CARDSIGHT_IDENTIFY_FEATURE_DISABLED_MESSAGE,
  CARDSIGHT_LIVE_VIDEO_ENABLED,
  CARDSIGHT_PRICING_ENABLED,
  CARDSIGHT_PUBLIC_ENDPOINT,
  cardsightIdentifySkippedResult,
  stillIdentifySkippedResult,
} from "./recognition-flags";
import {
  forbiddenSettingsLiveVendorConfig,
  settingsVisibleCopy,
} from "./settings";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("CardSight recognition flags", () => {
  it("keeps pricing and live video off", () => {
    const pricingEnabled: false = CARDSIGHT_PRICING_ENABLED;
    const liveVideoEnabled: false = CARDSIGHT_LIVE_VIDEO_ENABLED;
    expect(pricingEnabled).toBe(false);
    expect(liveVideoEnabled).toBe(false);
    expect(CARDSIGHT_IDENTIFY_ENABLED_FLAG).toBe("cardsight_identify_enabled");
    expect(CARDSIGHT_PUBLIC_ENDPOINT).toBe("https://api.cardsight.ai");
    expect(cardsightIdentifySkippedResult("missing_image")).toMatchObject({
      provider: "cardsight",
      ok: false,
      vendorRequestId: null,
      detections: [],
      error: {
        code: "BAD_REQUEST",
        message: CARDSIGHT_IDENTIFY_FEATURE_DISABLED_MESSAGE,
        retryable: false,
      },
    });
    expect(stillIdentifySkippedResult("oversize_image")).toMatchObject({
      provider: "mock",
      ok: false,
      detections: [],
      error: {
        code: "BAD_REQUEST",
        message: CARDSIGHT_IDENTIFY_FEATURE_DISABLED_MESSAGE,
        retryable: false,
      },
    });
  });

  it("is not a Settings research flag and has no in-app enable path", () => {
    expect(CARDSIGHT_IDENTIFY_ENABLED_FLAG in FEATURE_FLAG_DEFAULTS).toBe(false);
    expect("cardsight_pricing_enabled" in FEATURE_FLAG_DEFAULTS).toBe(false);
    expect("cardsight_live_video_enabled" in FEATURE_FLAG_DEFAULTS).toBe(false);

    const settings = readRepoFile("apps/mobile/app/settings.tsx");
    expect(forbiddenSettingsLiveVendorConfig(settingsVisibleCopy())).toBeNull();
    expect(forbiddenSettingsLiveVendorConfig(settings)).toBeNull();
    expect(settings).not.toMatch(/<Switch[\s/>]/);
    expect(settings).not.toContain('accessibilityRole="switch"');
    expect(settings).not.toContain("TextInput");
    expect(settings).not.toMatch(/cardsight/i);
    expect(settings).not.toMatch(/live video/i);
    expect(FEATURE_FLAG_DEFAULTS.live_identification_research).toBe(false);
    expect(FEATURE_FLAG_DEFAULTS.pricing_provider_enabled).toBe(false);
  });
});
