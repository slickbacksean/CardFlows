import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * P4 release prep: one env layout for the three EAS profiles (eas.json). Everything here is
 * inert until Sean sets real values: an unset API URL falls back to the local dev API, an
 * unset Sentry DSN keeps crash reporting off, and an unset PostHog key keeps analytics off
 * (analytics also needs the user's opt-in).
 *
 * Real values go in EAS environment variables (`eas env:create --environment production …`),
 * never in this file or eas.json. See docs/RELEASE_ENV.md and apps/mobile/.env.example.
 */
export type AppEnv = "development" | "preview" | "production";

export const APP_ENVS: readonly AppEnv[] = ["development", "preview", "production"];

/** The placeholders. All `EXPO_PUBLIC_*` so Metro inlines them into the JS bundle. */
export const RELEASE_ENV_KEYS = {
  apiUrl: "EXPO_PUBLIC_API_URL",
  sentryDsn: "EXPO_PUBLIC_SENTRY_DSN",
  posthogKey: "EXPO_PUBLIC_POSTHOG_KEY",
  posthogHost: "EXPO_PUBLIC_POSTHOG_HOST",
} as const;

type Env = Record<string, string | undefined>;

export function appEnvFrom(value: string | undefined): AppEnv {
  return APP_ENVS.includes(value as AppEnv) ? (value as AppEnv) : "development";
}

const isSet = (value: string | undefined) => typeof value === "string" && value.trim().length > 0;

export interface ReleaseEnvSummary {
  appEnv: AppEnv;
  apiUrlSet: boolean;
  crashReportingConfigured: boolean;
  analyticsConfigured: boolean;
  /** Placeholders a preview or production build still needs. Empty for development. */
  missingForRelease: string[];
}

/** Only booleans and key names: no value (not even the public DSN) is copied into `extra`. */
export function releaseEnvSummary(env: Env): ReleaseEnvSummary {
  const appEnv = appEnvFrom(env.APP_ENV ?? env.EXPO_PUBLIC_APP_ENV);
  const needed = [RELEASE_ENV_KEYS.apiUrl, RELEASE_ENV_KEYS.sentryDsn, RELEASE_ENV_KEYS.posthogKey];
  return {
    appEnv,
    apiUrlSet: isSet(env[RELEASE_ENV_KEYS.apiUrl]),
    crashReportingConfigured: isSet(env[RELEASE_ENV_KEYS.sentryDsn]),
    analyticsConfigured: isSet(env[RELEASE_ENV_KEYS.posthogKey]),
    missingForRelease: appEnv === "development" ? [] : needed.filter((key) => !isSet(env[key])),
  };
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const release = releaseEnvSummary(process.env);
  return {
    ...(config as ExpoConfig),
    extra: {
      ...config.extra,
      appEnv: release.appEnv,
      release,
    },
  };
};
