import type { CatalogError } from "./types";

/** Kill switch for live TCGdex. Resolved from env on the API; CI stays on mock. */
export const TCGDEX_CATALOG_ENABLED_FLAG = "tcgdex_catalog_enabled" as const;

/** Must stay false until founder-approved self-host. */
export const TCGDEX_SELF_HOSTED = false as const;

/** Adapter always drops TCGdex `pricing`. Not optional. */
export const TCGDEX_PRICING_IGNORED = true as const;

export const TCGDEX_PUBLIC_ENDPOINT = "https://api.tcgdex.net/v2";
export const TCGDEX_CATALOG_CACHE_TTL_SECONDS = 3600;
export const TCGDEX_CATALOG_TIMEOUT_MS = 7000;
export const TCGDEX_CATALOG_MAX_RETRIES = 2;

export const CATALOG_UNAVAILABLE_MESSAGE = "Catalog unavailable, try again.";

export const CATALOG_SEARCH_MANUALLY_MESSAGE =
  "We couldn't match this scan to the catalog — search English Pokémon sets";

export const CATALOG_FEATURE_DISABLED_MESSAGE =
  "Catalog is off — search manually by English set and number.";

export const CATALOG_CACHED_STALE_MESSAGE =
  "Cached catalog — it may be stale. Confirm still required.";

export const CATALOG_NAME_ONLY_NOTICE =
  "Name-only is not enough to confirm. Pick a row or search by English set and number.";

export const CATALOG_SEARCH_HINT =
  "Search by English set and number. Name-only will not confirm a card.";

export function catalogFeatureDisabledError(): CatalogError {
  return {
    code: "FEATURE_DISABLED",
    message: CATALOG_FEATURE_DISABLED_MESSAGE,
    retryable: false,
  };
}
