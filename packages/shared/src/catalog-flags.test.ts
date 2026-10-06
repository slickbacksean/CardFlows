import { describe, expect, it } from "vitest";
import {
  CATALOG_CACHED_STALE_MESSAGE,
  CATALOG_FEATURE_DISABLED_MESSAGE,
  CATALOG_NAME_ONLY_NOTICE,
  CATALOG_SEARCH_HINT,
  TCGDEX_CATALOG_CACHE_TTL_SECONDS,
  TCGDEX_CATALOG_ENABLED_FLAG,
  TCGDEX_CATALOG_MAX_RETRIES,
  TCGDEX_CATALOG_TIMEOUT_MS,
  TCGDEX_PRICING_IGNORED,
  TCGDEX_PUBLIC_ENDPOINT,
  TCGDEX_SELF_HOSTED,
  catalogFeatureDisabledError,
} from "./catalog-flags";
import { FEATURE_FLAG_DEFAULTS } from "./feature-flags";

describe("TCGdex catalog flags", () => {
  it("keeps self-host off and pricing ignored", () => {
    const selfHosted: false = TCGDEX_SELF_HOSTED;
    const pricingIgnored: true = TCGDEX_PRICING_IGNORED;
    expect(selfHosted).toBe(false);
    expect(pricingIgnored).toBe(true);
    expect(TCGDEX_CATALOG_ENABLED_FLAG).toBe("tcgdex_catalog_enabled");
    expect(TCGDEX_PUBLIC_ENDPOINT).toBe("https://api.tcgdex.net/v2");
    expect(TCGDEX_CATALOG_CACHE_TTL_SECONDS).toBeGreaterThanOrEqual(3600);
    expect(TCGDEX_CATALOG_TIMEOUT_MS).toBeGreaterThanOrEqual(5000);
    expect(TCGDEX_CATALOG_TIMEOUT_MS).toBeLessThanOrEqual(8000);
    expect(TCGDEX_CATALOG_MAX_RETRIES).toBe(2);
  });

  it("is not a Settings research flag and has no in-app enable path", () => {
    expect(TCGDEX_CATALOG_ENABLED_FLAG in FEATURE_FLAG_DEFAULTS).toBe(false);
    expect("tcgdex_self_hosted" in FEATURE_FLAG_DEFAULTS).toBe(false);
    expect(catalogFeatureDisabledError()).toEqual({
      code: "FEATURE_DISABLED",
      message: CATALOG_FEATURE_DISABLED_MESSAGE,
      retryable: false,
    });
    expect(CATALOG_FEATURE_DISABLED_MESSAGE.toLowerCase()).toContain("search manually");
    expect(CATALOG_NAME_ONLY_NOTICE.toLowerCase()).toContain("name-only");
    expect(CATALOG_CACHED_STALE_MESSAGE.toLowerCase()).toContain("cached");
    expect(CATALOG_SEARCH_HINT.toLowerCase()).toContain("set and number");
  });
});
