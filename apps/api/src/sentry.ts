import * as Sentry from "@sentry/node";
import { scrubSentryEvent } from "@cardflow/shared";

export interface CrashReporter {
  init: (options: Record<string, unknown>) => void;
  captureException: (error: unknown) => void;
  withScope: (callback: (scope: { setTag: (key: string, value: string) => void }) => void) => void;
}

const nodeReporter: CrashReporter = {
  init(options) {
    Sentry.init({
      dsn: typeof options.dsn === "string" ? options.dsn : undefined,
      environment: typeof options.environment === "string" ? options.environment : undefined,
      tracesSampleRate: 0,
      enableOpenTelemetrySetup: false,
      enableRuntimeChannelInjection: false,
      beforeSend(event) {
        return scrubSentryEvent(event);
      },
    });
  },
  captureException(error) {
    Sentry.captureException(error);
  },
  withScope(callback) {
    Sentry.withScope((scope) => {
      callback({
        setTag(key, value) {
          scope.setTag(key, value);
        },
      });
    });
  },
};

let reporter: CrashReporter | null = null;

/** No-op unless `SENTRY_DSN` is set. */
export function initApiSentry(
  env: NodeJS.Dict<string | undefined> = process.env,
  impl: CrashReporter = nodeReporter,
): boolean {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) {
    reporter = null;
    return false;
  }
  reporter = impl;
  impl.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || undefined,
    sendDefaultPii: false,
  });
  return true;
}

export function captureApiException(
  error: unknown,
  context: { requestId?: string } = {},
): void {
  if (!reporter) return;
  reporter.withScope((scope) => {
    if (context.requestId) scope.setTag("request_id", context.requestId);
    reporter?.captureException(error);
  });
}

export function apiSentryEnabled(): boolean {
  return reporter != null;
}

/** Tests only. */
export function disableApiSentry(): void {
  reporter = null;
}
