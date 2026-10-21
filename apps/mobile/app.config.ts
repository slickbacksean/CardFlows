import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * P4 release prep: one env layout for the three EAS profiles (eas.json). Real values go in EAS
 * environment variables (`eas env:create --environment production …`), never in this file or
 * eas.json. See docs/RELEASE_ENV.md and apps/mobile/.env.example.
 *
 * Dev Ops review: preview and production builds REQUIRE a public EXPO_PUBLIC_API_URL (this file
 * throws otherwise, so a release can never fall back to 127.0.0.1 / 10.0.2.2). Sentry and PostHog
 * stay optional: unset means off.
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

/**
 * Dev Ops review: every EXPO_PUBLIC_* variable the app reads. All of them are public: Metro
 * inlines them into the JS bundle, so none may hold a secret. `profiles` = where it may be set.
 */
export const PUBLIC_ENV_VARS: ReadonlyArray<{
  name: string;
  purpose: string;
  profiles: readonly AppEnv[];
  /** Build fails if set outside `profiles`. Otherwise `profiles` is guidance (docs/RELEASE_ENV.md). */
  enforced?: true;
}> = [
  { name: "EXPO_PUBLIC_APP_ENV", purpose: "Profile name (set by eas.json)", profiles: APP_ENVS },
  { name: "EXPO_PUBLIC_API_URL", purpose: "PokeSniper API base URL (required for preview and production; an EAS environment variable per profile, no default)", profiles: APP_ENVS },
  { name: "EXPO_PUBLIC_SENTRY_DSN", purpose: "Sentry crash reports (optional)", profiles: APP_ENVS },
  { name: "EXPO_PUBLIC_SENTRY_ENVIRONMENT", purpose: "Sentry environment override (optional; default = APP_ENV)", profiles: APP_ENVS },
  { name: "EXPO_PUBLIC_POSTHOG_KEY", purpose: "PostHog project key (optional, plus user opt-in)", profiles: APP_ENVS },
  { name: "EXPO_PUBLIC_POSTHOG_HOST", purpose: "PostHog host (default in eas.json base)", profiles: APP_ENVS },
  { name: "EXPO_PUBLIC_CARD_FLOW_APP_KEY", purpose: "App key header for the API (an abuse speed bump, not a secret)", profiles: APP_ENVS },
  { name: "EXPO_PUBLIC_HUDS_URL", purpose: "Livestream HUD helper URL (local tooling)", profiles: ["development", "preview"] },
  { name: "EXPO_PUBLIC_CARD_FLOW_GRADE_JOBS", purpose: "Async pre-grade jobs (=1)", profiles: APP_ENVS },
  { name: "EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TIMING", purpose: "Livestream timing logs (=1)", profiles: ["development", "preview"], enforced: true },
  { name: "EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_PRICE_SNAPSHOT", purpose: "Bulk livestream price snapshot (=1; default off, Policy risk)", profiles: ["development", "preview"], enforced: true },
  { name: "EXPO_PUBLIC_APPLE_SIGNIN_ENABLED", purpose: "Sign in with Apple entitlement + button (=1; needs a rebuild; default off)", profiles: APP_ENVS },
  { name: "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID", purpose: "Google sign-in OAuth client ID for iOS (optional; public)", profiles: APP_ENVS },
  { name: "EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID", purpose: "Google sign-in OAuth client ID for Android (optional; public)", profiles: APP_ENVS },
  { name: "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID", purpose: "Google sign-in OAuth web client ID (optional; public)", profiles: APP_ENVS },
  { name: "EXPO_PUBLIC_CARD_FLOW_IAP_ENABLED", purpose: "In-app purchases (true/1; off hides every price)", profiles: APP_ENVS },
  { name: "EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TCGPLAYER_LINK", purpose: "HUD shows See prices on TCGplayer instead of estimate (=1)", profiles: APP_ENVS },
];

type Env = Record<string, string | undefined>;

/** Unset means development (local runs). Anything else unknown is a mistake: throw. */
export function appEnvFrom(value: string | undefined): AppEnv {
  const trimmed = value?.trim();
  if (!trimmed) return "development";
  if (APP_ENVS.includes(trimmed as AppEnv)) return trimmed as AppEnv;
  throw new Error(`APP_ENV must be one of ${APP_ENVS.join(", ")} (got "${trimmed}")`);
}

const isSet = (value: string | undefined) => typeof value === "string" && value.trim().length > 0;

/** Same rule as packages/shared isLoopbackOrLanHost (kept local: app.config runs in plain Node). */
export function isLoopbackOrLanHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  if (host.endsWith(".local") || host.endsWith(".localhost")) return true;
  if (/^127\./.test(host) || /^169\.254\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

export interface ReleaseEnvSummary {
  appEnv: AppEnv;
  apiUrlSet: boolean;
  crashReportingConfigured: boolean;
  analyticsConfigured: boolean;
  /** Required values a preview or production build still needs: only the API URL. */
  missingForRelease: string[];
  /** Optional values left unset (feature stays off). Not required. */
  optionalUnset: string[];
}

/** Only booleans and key names: no value (not even the public DSN) is copied into `extra`. */
export function releaseEnvSummary(env: Env): ReleaseEnvSummary {
  const appEnv = appEnvFrom(env.APP_ENV ?? env.EXPO_PUBLIC_APP_ENV);
  const optional = [RELEASE_ENV_KEYS.sentryDsn, RELEASE_ENV_KEYS.posthogKey];
  return {
    appEnv,
    apiUrlSet: isSet(env[RELEASE_ENV_KEYS.apiUrl]),
    crashReportingConfigured: isSet(env[RELEASE_ENV_KEYS.sentryDsn]),
    analyticsConfigured: isSet(env[RELEASE_ENV_KEYS.posthogKey]),
    missingForRelease: appEnv === "development" || isSet(env[RELEASE_ENV_KEYS.apiUrl]) ? [] : [RELEASE_ENV_KEYS.apiUrl],
    optionalUnset: optional.filter((key) => !isSet(env[key])),
  };
}

/** Problems that must stop a preview or production build. Empty for development. */
export function releaseEnvErrors(env: Env): string[] {
  const appEnv = appEnvFrom(env.APP_ENV ?? env.EXPO_PUBLIC_APP_ENV);
  if (appEnv === "development") return [];
  const errors: string[] = [];
  const raw = env[RELEASE_ENV_KEYS.apiUrl]?.trim() ?? "";
  if (!raw) {
    errors.push(`${RELEASE_ENV_KEYS.apiUrl} is required for ${appEnv} builds`);
  } else {
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        errors.push(`${RELEASE_ENV_KEYS.apiUrl} must be an http(s) URL`);
      } else if (isLoopbackOrLanHost(url.hostname)) {
        errors.push(`${RELEASE_ENV_KEYS.apiUrl} points at a loopback/LAN host (${url.hostname}); ${appEnv} builds need the public API`);
      }
    } catch {
      errors.push(`${RELEASE_ENV_KEYS.apiUrl} is not a valid URL`);
    }
  }
  for (const v of PUBLIC_ENV_VARS) {
    if (v.enforced && !v.profiles.includes(appEnv) && isSet(env[v.name])) errors.push(`${v.name} must not be set in ${appEnv} builds`);
  }
  return errors;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const errors = releaseEnvErrors(process.env);
  if (errors.length > 0) throw new Error(`CardFlow release config:\n- ${errors.join("\n- ")}`);
  const release = releaseEnvSummary(process.env);
  // Mobile Tech Lead (PR 113): the Sign in with Apple entitlement + plugin only when the build
  // opts in, so the current dev client and Expo Go don't need a rebuild. Off by default.
  const appleSignIn = process.env.EXPO_PUBLIC_APPLE_SIGNIN_ENABLED?.trim() === "1";
  const base = config as ExpoConfig;
  return {
    ...base,
    ...(appleSignIn
      ? {
          ios: { ...base.ios, usesAppleSignIn: true },
          plugins: [...(base.plugins ?? []), "expo-apple-authentication"],
        }
      : {}),
    extra: {
      ...config.extra,
      appEnv: release.appEnv,
      release,
    },
  };
};
