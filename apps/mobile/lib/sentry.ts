import { CRASH_REPORTS_STORE_KEY, crashReportsEnabledFrom, scrubSentryEvent } from "@cardflow/shared";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

type SentryModule = typeof import("@sentry/react-native");

let sentry: SentryModule | null = null;
let enabled = false;
/** Settings > Send crash reports (off by default, opt-in). Independent of the analytics opt-in. */
let crashReportsOn = crashReportsEnabledFrom(null);

function sentryDsn(): string | undefined {
  const value = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  return value || undefined;
}

/** Expo Go has no Sentry native binary. JS init is still allowed; native stays off. */
function isExpoGo(): boolean {
  return Constants.appOwnership === "expo" || Constants.executionEnvironment === "storeClient";
}

/** Dev Ops review: environment, release and dist so events line up with EAS builds. */
function sentryRelease() {
  const config = Constants.expoConfig;
  const version = config?.version ?? "0.0.0";
  const bundle = config?.ios?.bundleIdentifier ?? config?.android?.package ?? "app.pokesniper.mobile";
  const build = Platform.OS === "ios" ? config?.ios?.buildNumber : config?.android?.versionCode;
  return {
    environment: process.env.EXPO_PUBLIC_APP_ENV?.trim() || "development",
    release: `${bundle}@${version}`,
    dist: build === undefined || build === null ? undefined : String(build),
  };
}

/**
 * Init only when `EXPO_PUBLIC_SENTRY_DSN` is set and Send crash reports is on. Never throws:
 * Expo Go and web keep running if the native module is missing. Dev builds don't send
 * (`enabled: !__DEV__`).
 */
export function initMobileSentry(): boolean {
  const dsn = sentryDsn();
  if (!dsn) {
    enabled = false;
    sentry = null;
    return false;
  }
  if (!crashReportsOn) {
    enabled = false;
    return false;
  }
  if (enabled && sentry) return true;
  try {
    // Loaded only after the DSN check so a missing DSN never talks to Sentry.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require("@sentry/react-native") as SentryModule;
    const native = Platform.OS !== "web" && !isExpoGo();
    loaded.init({
      dsn,
      enabled: !__DEV__,
      ...sentryRelease(),
      sendDefaultPii: false,
      enableNative: native,
      enableNativeCrashHandling: native,
      enableNativeFramesTracking: native,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableCaptureFailedRequests: false,
      enableAutoSessionTracking: false,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      tracesSampleRate: 0,
      integrations(integrations) {
        return integrations.filter(
          (integration) =>
            integration.name !== "Replay" &&
            integration.name !== "MobileReplay" &&
            integration.name !== "Screenshot",
        );
      },
      beforeSend(event) {
        // The toggle may have been turned off after init: drop anything still queued.
        if (!crashReportsOn) return null;
        return scrubSentryEvent(event);
      },
    });
    sentry = loaded;
    enabled = true;
    return true;
  } catch {
    sentry = null;
    enabled = false;
    return false;
  }
}

export async function loadCrashReportsPreference(): Promise<boolean> {
  try {
    crashReportsOn = crashReportsEnabledFrom(await SecureStore.getItemAsync(CRASH_REPORTS_STORE_KEY));
  } catch {
    crashReportsOn = crashReportsEnabledFrom(null);
  }
  return crashReportsOn;
}

/** Settings > Send crash reports. Off stops sending right away; on starts Sentry again. */
export async function setCrashReportsEnabled(next: boolean): Promise<void> {
  crashReportsOn = next;
  if (!next) {
    const client = sentry;
    enabled = false;
    sentry = null;
    try {
      await client?.close();
    } catch {
      // already closed
    }
  } else {
    initMobileSentry();
  }
  await SecureStore.setItemAsync(CRASH_REPORTS_STORE_KEY, next ? "1" : "0").catch(() => undefined);
}

export function crashReportsEnabled(): boolean {
  return crashReportsOn;
}

export function captureMobileException(error: unknown): void {
  if (!crashReportsOn || !enabled || !sentry) return;
  sentry.captureException(error);
}

export function mobileSentryEnabled(): boolean {
  return enabled;
}
