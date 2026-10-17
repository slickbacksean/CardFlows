import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETION_COPY,
  isAccountDeletionConfirmed,
  LOCAL_ACCOUNT_WIPE_STEPS,
  runLocalAccountWipe,
} from "./account-deletion";
import { guestRouteAllowed } from "./guest-access";
import { pregradeCopyViolations } from "./pregrade-copy";
import { REDACTED_PHOTO_URI, REDACTED_TOKEN, scrubSentryEvent } from "./sentry-scrub";
import { SIGN_IN_WITH_APPLE, signInWithAppleAvailable } from "./sign-in-with-apple";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p: string) => readFileSync(path.join(REPO, p), "utf8");

type ReleaseSummary = {
  appEnv: string;
  apiUrlSet: boolean;
  crashReportingConfigured: boolean;
  analyticsConfigured: boolean;
  missingForRelease: string[];
};
type AppConfigModule = {
  default: (ctx: { config: Record<string, unknown> }) => Record<string, unknown> & { extra?: Record<string, unknown>; name?: string };
  appEnvFrom: (raw: string | undefined) => string;
  releaseEnvSummary: (env: Record<string, string | undefined>) => ReleaseSummary;
  RELEASE_ENV_KEYS: Record<"apiUrl" | "sentryDsn" | "posthogKey" | "posthogHost", string>;
};
// Loaded by path at runtime: app.config.ts lives outside this package's tsconfig rootDir.
let mobileConfig: AppConfigModule;
const RELEASE_ENV_KEYS = {
  apiUrl: "EXPO_PUBLIC_API_URL",
  sentryDsn: "EXPO_PUBLIC_SENTRY_DSN",
  posthogKey: "EXPO_PUBLIC_POSTHOG_KEY",
  posthogHost: "EXPO_PUBLIC_POSTHOG_HOST",
} as const;
beforeAll(async () => {
  const modulePath = path.join(REPO, "apps/mobile/app.config.ts");
  mobileConfig = (await import(modulePath)) as AppConfigModule;
});

describe("P4: EAS profiles and env layout", () => {
  const eas = JSON.parse(read("apps/mobile/eas.json")) as {
    cli: Record<string, unknown>;
    build: Record<"base" | "development" | "preview" | "production", { extends?: string; env?: Record<string, string>; environment?: string; developmentClient?: boolean; distribution?: string }>;
  };

  it("has development, preview and production, each with its own env and EAS environment", () => {
    for (const profile of ["development", "preview", "production"] as const) {
      const p = eas.build[profile];
      expect(p, profile).toBeDefined();
      expect(p.extends).toBe("base");
      expect(p.environment).toBe(profile);
      expect(p.env?.APP_ENV).toBe(profile);
      expect(p.env?.EXPO_PUBLIC_APP_ENV).toBe(profile);
    }
    expect(eas.build.development.developmentClient).toBe(true);
    expect(eas.build.preview.developmentClient).toBeUndefined();
    expect(eas.build.production.developmentClient).toBeUndefined();
    expect(eas.build.production.distribution).toBeUndefined();
  });

  it("commits no API URL, DSN or analytics key (they're EAS environment variables)", () => {
    const raw = read("apps/mobile/eas.json");
    for (const key of [RELEASE_ENV_KEYS.apiUrl, RELEASE_ENV_KEYS.sentryDsn, RELEASE_ENV_KEYS.posthogKey]) {
      expect(raw).not.toContain(key);
    }
    expect(raw).not.toMatch(/https:\/\/[a-f0-9]+@[^"]*sentry\.io|phc_[A-Za-z0-9]+/);
    const example = read("apps/mobile/.env.example");
    for (const key of Object.values(RELEASE_ENV_KEYS)) expect(example).toContain(`${key}=`);
    expect(example).toMatch(/^EXPO_PUBLIC_SENTRY_DSN=$/m);
    expect(example).toMatch(/^EXPO_PUBLIC_POSTHOG_KEY=$/m);
    expect(example).toMatch(/^EXPO_PUBLIC_API_URL=$/m);
  });

  it("app.config exports the same keys", () => {
    expect(mobileConfig.RELEASE_ENV_KEYS).toEqual(RELEASE_ENV_KEYS);
  });

  it("app.config is inert without values and never copies a value into extra", () => {
    const { appEnvFrom, releaseEnvSummary, default: appConfig } = mobileConfig;
    expect(appEnvFrom(undefined)).toBe("development");
    expect(appEnvFrom("staging")).toBe("development");
    expect(appEnvFrom("production")).toBe("production");
    expect(releaseEnvSummary({})).toEqual({
      appEnv: "development",
      apiUrlSet: false,
      crashReportingConfigured: false,
      analyticsConfigured: false,
      missingForRelease: [],
    });
    expect(releaseEnvSummary({ APP_ENV: "production", EXPO_PUBLIC_SENTRY_DSN: "  " }).missingForRelease).toEqual([
      "EXPO_PUBLIC_API_URL",
      "EXPO_PUBLIC_SENTRY_DSN",
      "EXPO_PUBLIC_POSTHOG_KEY",
    ]);
    const full = {
      APP_ENV: "preview",
      EXPO_PUBLIC_API_URL: "https://api.example.com",
      EXPO_PUBLIC_SENTRY_DSN: "https://abc@o1.ingest.sentry.io/2",
      EXPO_PUBLIC_POSTHOG_KEY: "phc_secret",
    };
    expect(releaseEnvSummary(full).missingForRelease).toEqual([]);
    const before = { ...process.env };
    Object.assign(process.env, full);
    try {
      const built = appConfig({ config: { name: "CardFlow", slug: "cardflow", extra: { eas: { projectId: "x" } } } });
      const json = JSON.stringify(built);
      expect(json).not.toContain("phc_secret");
      expect(json).not.toContain("sentry.io");
      expect(json).not.toContain("api.example.com");
      expect(built.extra?.appEnv).toBe("preview");
      expect(built.extra?.eas).toEqual({ projectId: "x" });
      expect(built.name).toBe("CardFlow");
    } finally {
      process.env = before;
    }
  });
});

describe("P4: Sentry scaffold", () => {
  const sentry = read("apps/mobile/lib/sentry.ts");

  it("is off without a DSN: returns before the SDK is even loaded", () => {
    const check = sentry.indexOf("if (!dsn)");
    const load = sentry.indexOf('require("@sentry/react-native")');
    expect(check).toBeGreaterThan(0);
    expect(load).toBeGreaterThan(check);
    expect(sentry).toContain("process.env.EXPO_PUBLIC_SENTRY_DSN?.trim()");
  });

  it("sends no PII, photos, screenshots, replays or traces", () => {
    for (const needle of [
      "sendDefaultPii: false",
      "attachScreenshot: false",
      "attachViewHierarchy: false",
      "enableCaptureFailedRequests: false",
      "replaysSessionSampleRate: 0",
      "replaysOnErrorSampleRate: 0",
      "tracesSampleRate: 0",
      "return scrubSentryEvent(event)",
    ]) {
      expect(sentry).toContain(needle);
    }
    expect(sentry).not.toMatch(/setUser\(/);
  });

  it("scrubs bearer tokens, secret query params and local photo URIs (new in P4)", () => {
    const event = scrubSentryEvent({
      message: "upload failed for file:///var/mobile/Containers/Data/scan-queue/abc.jpg with Bearer abc.def.ghi",
      breadcrumbs: [
        { category: "fetch", data: { url: "https://api.example.com/v1/password-resets/confirm?token=s3cret&x=1" } },
        { message: "content://media/external/images/123.png" },
      ],
      extra: { token: "t", password: "p", note: "verify?code=123456" },
      user: { id: "u1", email: "a@b.co", ip_address: "1.2.3.4" },
    }) as Record<string, unknown>;
    const json = JSON.stringify(event);
    expect(json).not.toMatch(/s3cret|abc\.def\.ghi|123456|scan-queue\/abc\.jpg|images\/123\.png|a@b\.co|1\.2\.3\.4/);
    expect(json).toContain(REDACTED_TOKEN);
    expect(json).toContain(REDACTED_PHOTO_URI);
    expect((event.user as Record<string, unknown>).id).toBe("u1");
  });

  it("keeps the existing rule: crash reports don't depend on the analytics opt-in (documented)", () => {
    expect(sentry).not.toMatch(/isAnalyticsEnabled|loadAnalyticsPreference/);
    expect(read("docs/RELEASE_ENV.md")).toContain("does **not** tie crash reporting to the analytics opt-in");
  });
});

describe("P4: account deletion end to end", () => {
  it("guests may call delete (they used to get signup_required)", () => {
    expect(guestRouteAllowed("POST", "/v1/account/delete")).toBe(true);
    expect(guestRouteAllowed("POST", "/v1/inventory/purchased")).toBe(false);
  });

  it("typed confirmation", () => {
    expect(isAccountDeletionConfirmed(" delete ")).toBe(true);
    expect(isAccountDeletionConfirmed("DELET")).toBe(false);
    expect(isAccountDeletionConfirmed("")).toBe(false);
  });

  it("wipes every local step in order, even when one fails", async () => {
    const ran: string[] = [];
    const steps = Object.fromEntries(
      LOCAL_ACCOUNT_WIPE_STEPS.map((step) => [
        step,
        () => {
          ran.push(step);
          if (step === "scan_queue") throw new Error("disk");
        },
      ]),
    ) as Parameters<typeof runLocalAccountWipe>[0];
    expect(await runLocalAccountWipe(steps)).toEqual({ failed: ["scan_queue"] });
    expect(ran).toEqual([...LOCAL_ACCOUNT_WIPE_STEPS]);
    expect(LOCAL_ACCOUNT_WIPE_STEPS.at(-1)).toBe("session");
  });

  it("the app deletes on the server first, then wipes the phone; Settings links the screen", () => {
    const lib = read("apps/mobile/lib/account-deletion.ts");
    expect(lib.indexOf("await deleteAccount()")).toBeGreaterThan(0);
    expect(lib.indexOf("runLocalAccountWipe(")).toBeGreaterThan(lib.indexOf("await deleteAccount()"));
    for (const step of LOCAL_ACCOUNT_WIPE_STEPS) expect(lib).toContain(`${step}:`);
    expect(read("apps/mobile/lib/api.ts")).toContain("callApi(apiContract.deleteAccountPhotos)");
    const screen = read("apps/mobile/app/delete-account.tsx");
    expect(screen).toContain("deleteAccountEverywhere()");
    expect(screen).toContain("isAccountDeletionConfirmed(typed)");
    expect(screen).toContain('style: "destructive"');
    expect(screen).toContain("setError(c.failed)");
    expect(screen).not.toMatch(/caught\.message|error\.message/);
    expect(read("apps/mobile/app/settings.tsx")).toContain('router.push("/delete-account")');
    expect(read("apps/mobile/app/_layout.tsx")).toContain('name="delete-account"');
  });

  it("deletion copy follows the copy rules", () => {
    const all = [...Object.values(ACCOUNT_DELETION_COPY).flat()];
    for (const text of all) {
      expect(pregradeCopyViolations(text), text).toEqual([]);
      expect(text, text).not.toMatch(/Could not|\bCollection\b/);
    }
    expect(ACCOUNT_DELETION_COPY.keeps).toContain("marketplace aren't affected");
  });
});

describe("P4: Sign in with Apple stays a documented stub", () => {
  it("is off everywhere and documented", () => {
    expect(SIGN_IN_WITH_APPLE.enabled).toBe(false);
    expect(signInWithAppleAvailable({ platform: "ios" })).toBe(false);
    const doc = read("docs/SIGN_IN_WITH_APPLE.md");
    expect(doc).toContain("Apple Developer account");
    expect(doc).toContain("4.8");
    expect(read("apps/mobile/package.json")).not.toContain("expo-apple-authentication");
    expect(read("apps/api/src/app.ts")).not.toContain("/v1/sessions/apple");
  });
});
