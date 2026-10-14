import { afterEach, describe, expect, it } from "vitest";
import {
  apiSentryEnabled,
  captureApiException,
  disableApiSentry,
  initApiSentry,
  type CrashReporter,
} from "./sentry";

function mockReporter() {
  const inits: Record<string, unknown>[] = [];
  const captured: Array<{ error: unknown; tags: Record<string, string> }> = [];
  let tags: Record<string, string> = {};
  const impl: CrashReporter = {
    init(options) {
      inits.push(options);
    },
    withScope(callback) {
      tags = {};
      callback({
        setTag(key, value) {
          tags[key] = value;
        },
      });
    },
    captureException(error) {
      captured.push({ error, tags: { ...tags } });
    },
  };
  return { impl, inits, captured };
}

describe("API Sentry", () => {
  afterEach(() => {
    disableApiSentry();
  });

  it("is a no-op when SENTRY_DSN is unset", () => {
    const { impl, inits, captured } = mockReporter();
    expect(initApiSentry({}, impl)).toBe(false);
    expect(apiSentryEnabled()).toBe(false);
    expect(inits).toEqual([]);
    captureApiException(new Error("boom"), { requestId: "req-1" });
    expect(captured).toEqual([]);
  });

  it("inits when SENTRY_DSN is set and tags the request id", () => {
    const { impl, inits, captured } = mockReporter();
    expect(
      initApiSentry(
        { SENTRY_DSN: "https://key@example.ingest.sentry.io/1", SENTRY_ENVIRONMENT: "staging" },
        impl,
      ),
    ).toBe(true);
    expect(apiSentryEnabled()).toBe(true);
    expect(inits[0]).toMatchObject({
      dsn: "https://key@example.ingest.sentry.io/1",
      environment: "staging",
      sendDefaultPii: false,
    });
    const error = new Error("forced crash");
    captureApiException(error, { requestId: "req-abc" });
    expect(captured).toEqual([{ error, tags: { request_id: "req-abc" } }]);
  });
});
