import { scrubSentryEvent } from "@cardflow/shared";
import Constants from "expo-constants";
import { Platform } from "react-native";

type SentryModule = typeof import("@sentry/react-native");

let sentry: SentryModule | null = null;
let enabled = false;

function sentryDsn(): string | undefined {
  const value = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  return value || undefined;
}

/** Expo Go has no Sentry native binary. JS init is still allowed; native stays off. */
function isExpoGo(): boolean {
  return Constants.appOwnership === "expo" || Constants.executionEnvironment === "storeClient";
}

/**
 * Init only when `EXPO_PUBLIC_SENTRY_DSN` is set. Never throws: Expo Go and web
 * keep running if the native module is missing.
 */
export function initMobileSentry(): boolean {
  const dsn = sentryDsn();
  if (!dsn) {
    enabled = false;
    sentry = null;
    return false;
  }
  try {
    // Loaded only after the DSN check so a missing DSN never talks to Sentry.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require("@sentry/react-native") as SentryModule;
    const native = Platform.OS !== "web" && !isExpoGo();
    loaded.init({
      dsn,
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

export function captureMobileException(error: unknown): void {
  if (!enabled || !sentry) return;
  sentry.captureException(error);
}

export function mobileSentryEnabled(): boolean {
  return enabled;
}
