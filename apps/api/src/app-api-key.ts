type Env = NodeJS.Dict<string | undefined>;

function isTestEnv(env: Env): boolean {
  return env.VITEST === "true" || env.NODE_ENV === "test";
}

/**
 * Speed-bump app key (P0-11). Not a secret: the Expo app sends it as
 * `X-CardFlow-App-Key`. Unset in tests unless `CARD_FLOW_APP_API_KEY` is set.
 */
export function appApiKeyFromEnv(env: Env = process.env): string | null {
  const raw = env.CARD_FLOW_APP_API_KEY?.trim() ?? "";
  if (!raw) return null;
  if (isTestEnv(env) && env.CARD_FLOW_APP_API_KEY === undefined) return null;
  return raw;
}

export const APP_API_KEY_HEADER = "x-cardflow-app-key";
