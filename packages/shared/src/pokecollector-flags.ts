/** Server env kill switch. Not a Settings toggle. */
export const POKECOLLECTOR_ENABLED_FLAG = "pokecollector_enabled" as const;

export const POKECOLLECTOR_CATALOG_TIMEOUT_MS = 7000;
export const POKECOLLECTOR_CATALOG_MAX_RETRIES = 2;
export const POKECOLLECTOR_HEALTH_PATH = "/api/health";
export const POKECOLLECTOR_CARDS_PATH = "/api/cards";
export const POKECOLLECTOR_CARD_SEARCH_PATH = "/api/cards/search";
export const POKECOLLECTOR_SETS_PATH = "/api/sets";
export const POKECOLLECTOR_EXCHANGE_RATE_PATH = "/api/settings/exchange-rate";
export const POKECOLLECTOR_AUTH_USERS_PATH = "/api/auth/users";
export const POKECOLLECTOR_AUTH_LOGIN_PATH = "/api/auth/login";
export const POKECOLLECTOR_COLLECTION_PATH = "/api/collection/";
export const POKECOLLECTOR_COLLECTION_USER_PATH = "/api/collection/user";
export const POKECOLLECTOR_WISHLIST_PATH = "/api/wishlist/";

export const POKECOLLECTOR_UNAVAILABLE_MESSAGE =
  "Catalog is temporarily unavailable — search manually by English set and number.";
