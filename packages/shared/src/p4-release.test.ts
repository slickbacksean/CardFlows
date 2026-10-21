import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETION_COPY,
  ANONYMOUS_LEDGER_LINE,
  accountDeletionOutcome,
  gradeFlowPhotoUris,
  isAccountDeletionConfirmed,
  legacyGradeHistoryKey,
  LOCAL_ACCOUNT_WIPE_STEPS,
  POKECOLLECTOR_DELETION_LINE,
  runLocalAccountWipe,
  wipesPhone,
} from "./account-deletion";
import { releaseApiUrlProblem, resolveClientApiUrl, ReleaseApiUrlError } from "./client-api-url";
import { CRASH_REPORTS_COPY, CRASH_REPORTS_DEFAULT_ON, crashReportsEnabledFrom } from "./crash-reports";
import { guestRouteAllowed } from "./guest-access";
import { pregradeCopyViolations } from "./pregrade-copy";
import { REDACTED_BLOB, REDACTED_PHOTO_URI, REDACTED_TOKEN, REDACTED_VALUE, scrubSentryEvent } from "./sentry-scrub";
import { SIGN_IN_WITH_APPLE, signInWithAppleAvailable } from "./sign-in-with-apple";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p: string) => readFileSync(path.join(REPO, p), "utf8");

type ReleaseSummary = {
  appEnv: string;
  apiUrlSet: boolean;
  crashReportingConfigured: boolean;
  analyticsConfigured: boolean;
  missingForRelease: string[];
  optionalUnset: string[];
};
type AppConfigModule = {
  default: (ctx: { config: Record<string, unknown> }) => Record<string, unknown> & { extra?: Record<string, unknown>; name?: string };
  appEnvFrom: (raw: string | undefined) => string;
  releaseEnvSummary: (env: Record<string, string | undefined>) => ReleaseSummary;
  releaseEnvErrors: (env: Record<string, string | undefined>) => string[];
  RELEASE_ENV_KEYS: Record<"apiUrl" | "sentryDsn" | "posthogKey" | "posthogHost", string>;
  PUBLIC_ENV_VARS: ReadonlyArray<{ name: string; profiles: readonly string[]; enforced?: true }>;
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

function withEnv<T>(env: Record<string, string>, run: () => T): T {
  const before = { ...process.env };
  for (const key of ["APP_ENV", "EXPO_PUBLIC_APP_ENV", ...Object.values(RELEASE_ENV_KEYS), "EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TIMING", "EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_PRICE_SNAPSHOT", "EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TCGPLAYER_LINK"]) delete process.env[key];
  Object.assign(process.env, env);
  try {
    return run();
  } finally {
    process.env = before;
  }
}
const CTX = { config: { name: "PokeSniper", slug: "cardflow", extra: { eas: { projectId: "x" } } } };

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("P4: EAS profiles and env layout", () => {
  const eas = JSON.parse(read("apps/mobile/eas.json")) as {
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

  it("Dev Ops: preview and production don't upload source maps until a Sentry token is an EAS secret", () => {
    expect(eas.build.preview.env?.SENTRY_DISABLE_AUTO_UPLOAD).toBe("true");
    expect(eas.build.production.env?.SENTRY_DISABLE_AUTO_UPLOAD).toBe("true");
    expect(read("docs/RELEASE_ENV.md")).toContain("SENTRY_DISABLE_AUTO_UPLOAD");
  });

  it("Dev Ops: EAS Update is configured (channels + appVersion runtime) but expo-updates needs a rebuild", () => {
    // Expo Go only for now: no new native module in this PR.
    expect(read("apps/mobile/package.json")).not.toContain("expo-updates");
    const raw = JSON.parse(read("apps/mobile/eas.json")) as { build: Record<string, { channel?: string }> };
    expect(raw.build.preview?.channel).toBe("preview");
    expect(raw.build.production?.channel).toBe("production");
    expect(raw.build.development?.channel).toBeUndefined();
    const app = JSON.parse(read("apps/mobile/app.json")) as { expo: { runtimeVersion?: unknown; updates?: { url?: string }; extra: { eas: { projectId: string } } } };
    expect(app.expo.runtimeVersion).toEqual({ policy: "appVersion" });
    expect(app.expo.updates?.url).toBe(`https://u.expo.dev/${app.expo.extra.eas.projectId}`);
    const doc = read("docs/RELEASE_ENV.md");
    for (const needle of ["EAS Update", "expo-updates", "rebuild", "channel", "runtimeVersion", "updates.url"]) expect(doc).toContain(needle);
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

  it("Dev Ops nit: appEnvFrom throws on unknown values (unset = development)", () => {
    const { appEnvFrom } = mobileConfig;
    expect(appEnvFrom(undefined)).toBe("development");
    expect(appEnvFrom("")).toBe("development");
    expect(appEnvFrom("production")).toBe("production");
    expect(() => appEnvFrom("staging")).toThrow(/APP_ENV/);
    expect(() => appEnvFrom("prod")).toThrow(/APP_ENV/);
  });

  it("Dev Ops nit: only the API URL is required; Sentry and PostHog stay optional", () => {
    const { releaseEnvSummary } = mobileConfig;
    expect(releaseEnvSummary({})).toEqual({
      appEnv: "development",
      apiUrlSet: false,
      crashReportingConfigured: false,
      analyticsConfigured: false,
      missingForRelease: [],
      optionalUnset: ["EXPO_PUBLIC_SENTRY_DSN", "EXPO_PUBLIC_POSTHOG_KEY"],
    });
    // Sean (Oct 20): production defaults to https://api.pokesniper.app; preview must set one.
    expect(releaseEnvSummary({ APP_ENV: "production" }).missingForRelease).toEqual([]);
    expect(releaseEnvSummary({ APP_ENV: "preview" }).missingForRelease).toEqual(["EXPO_PUBLIC_API_URL"]);
    const prod = releaseEnvSummary({ APP_ENV: "production", EXPO_PUBLIC_API_URL: "https://api.example.com" });
    expect(prod.missingForRelease).toEqual([]);
    expect(prod.optionalUnset).toEqual(["EXPO_PUBLIC_SENTRY_DSN", "EXPO_PUBLIC_POSTHOG_KEY"]);
  });

  it("Dev Ops (blocking): preview/production builds throw without a public API URL", () => {
    const build = mobileConfig.default;
    for (const appEnv of ["preview", "production"]) {
      if (appEnv === "preview") expect(() => withEnv({ APP_ENV: appEnv }, () => build(CTX)), appEnv).toThrow(/EXPO_PUBLIC_API_URL is required/);
      else expect(withEnv({ APP_ENV: appEnv }, () => build(CTX)).extra?.appEnv).toBe("production");
      for (const url of ["http://127.0.0.1:3001", "http://10.0.2.2:3001", "http://192.168.1.8:3001", "http://localhost:3001", "http://172.20.0.5", "http://[::1]:3001", "http://mac.local:3001"]) {
        expect(() => withEnv({ APP_ENV: appEnv, EXPO_PUBLIC_API_URL: url }, () => build(CTX)), `${appEnv} ${url}`).toThrow(/loopback\/LAN/);
      }
      expect(() => withEnv({ APP_ENV: appEnv, EXPO_PUBLIC_API_URL: "not a url" }, () => build(CTX))).toThrow(/not a valid URL/);
      // Sentry and PostHog unset is fine.
      expect(withEnv({ APP_ENV: appEnv, EXPO_PUBLIC_API_URL: "https://api.example.com" }, () => build(CTX)).extra?.appEnv).toBe(appEnv);
    }
    // Development (and plain local runs) never throw: they use the local API.
    expect(withEnv({}, () => build(CTX)).extra?.appEnv).toBe("development");
    expect(withEnv({ APP_ENV: "development", EXPO_PUBLIC_API_URL: "http://192.168.1.8:3001" }, () => build(CTX)).extra?.appEnv).toBe("development");
  });

  it("Dev Ops: LIVESTREAM_TIMING can't be set in production (preview is fine)", () => {
    const build = mobileConfig.default;
    const url = { EXPO_PUBLIC_API_URL: "https://api.example.com" };
    expect(() => withEnv({ APP_ENV: "production", ...url, EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TIMING: "1" }, () => build(CTX))).toThrow(
      /EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TIMING must not be set in production/,
    );
    expect(withEnv({ APP_ENV: "preview", ...url, EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TIMING: "1" }, () => build(CTX)).extra?.appEnv).toBe("preview");
  });

  it("app.config never copies a value into extra", () => {
    const full = {
      APP_ENV: "preview",
      EXPO_PUBLIC_API_URL: "https://api.example.com",
      EXPO_PUBLIC_SENTRY_DSN: "https://abc@o1.ingest.sentry.io/2",
      EXPO_PUBLIC_POSTHOG_KEY: "phc_secret",
    };
    const built = withEnv(full, () => mobileConfig.default(CTX));
    const json = JSON.stringify(built);
    expect(json).not.toContain("phc_secret");
    expect(json).not.toContain("sentry.io");
    expect(json).not.toContain("api.example.com");
    expect(built.extra?.appEnv).toBe("preview");
    expect(built.extra?.eas).toEqual({ projectId: "x" });
    expect(built.name).toBe("PokeSniper");
  });

  it("Dev Ops: every EXPO_PUBLIC_* the app reads is listed (app.config and RELEASE_ENV.md), as public", () => {
    const used = new Set<string>();
    for (const file of [...sourceFiles(path.join(REPO, "apps/mobile/app")), ...sourceFiles(path.join(REPO, "apps/mobile/lib")), ...sourceFiles(path.join(REPO, "apps/mobile/components"))]) {
      for (const match of readFileSync(file, "utf8").matchAll(/process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)/g)) used.add(match[1]!);
    }
    expect(used.size).toBeGreaterThan(5);
    const listed = new Set(mobileConfig.PUBLIC_ENV_VARS.map((v) => v.name));
    const doc = read("docs/RELEASE_ENV.md");
    for (const name of used) {
      expect(listed.has(name), `${name} in PUBLIC_ENV_VARS`).toBe(true);
      expect(doc, `${name} in RELEASE_ENV.md`).toContain(`\`${name}\``);
    }
    for (const name of listed) expect(doc).toContain(`\`${name}\``);
    expect(doc).toMatch(/public.*bundle/i);
  });

  it("Dev Ops: a release build never falls back to 127.0.0.1 / 10.0.2.2 at runtime", () => {
    expect(releaseApiUrlProblem({ configured: "", isDev: false })).toBe("missing");
    expect(releaseApiUrlProblem({ configured: undefined, isDev: false })).toBe("missing");
    expect(releaseApiUrlProblem({ configured: "http://10.0.2.2:3001", isDev: false })).toBe("loopback");
    expect(releaseApiUrlProblem({ configured: "ftp://api.example.com", isDev: false })).toBe("invalid");
    expect(releaseApiUrlProblem({ configured: "https://api.example.com", isDev: false })).toBeNull();
    expect(releaseApiUrlProblem({ configured: "", isDev: true })).toBeNull();
    for (const platform of ["ios", "android", "web"]) {
      expect(() =>
        resolveClientApiUrl({ configured: "", platform, isDev: false, isPhysical: true, defaultUrl: "http://127.0.0.1:3001" }),
      ).toThrow(ReleaseApiUrlError);
    }
    expect(resolveClientApiUrl({ configured: "", platform: "android", isDev: true, isPhysical: false, defaultUrl: "http://10.0.2.2:3001" })).toBe(
      "http://10.0.2.2:3001",
    );
    const layout = read("apps/mobile/app/_layout.tsx");
    expect(layout).toContain("configured: configuredApiUrlFor(process.env.EXPO_PUBLIC_API_URL, process.env.EXPO_PUBLIC_APP_ENV)");
    expect(layout).toContain("isDev: __DEV__");
    expect(layout).toContain("if (RELEASE_API_URL_PROBLEM) return <ReleaseConfigErrorScreen />;");
  });
});

describe("P4: Sentry scaffold", () => {
  const sentry = read("apps/mobile/lib/sentry.ts");

  it("is off without a DSN or with Send crash reports off: returns before the SDK is loaded", () => {
    const check = sentry.indexOf("if (!dsn)");
    const toggle = sentry.indexOf("if (!crashReportsOn)");
    const load = sentry.indexOf('require("@sentry/react-native")');
    expect(check).toBeGreaterThan(0);
    expect(toggle).toBeGreaterThan(check);
    expect(load).toBeGreaterThan(toggle);
    expect(sentry).toContain("process.env.EXPO_PUBLIC_SENTRY_DSN?.trim()");
  });

  it("sends no PII, photos, screenshots, replays or traces; not from dev builds", () => {
    for (const needle of [
      "enabled: !__DEV__",
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

  it("Dev Ops: environment from SENTRY_ENVIRONMENT / APP_ENV, plus release (version+build) and dist", () => {
    expect(sentry).toContain("sentryEnvironment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT");
    expect(sentry).toContain("appEnv: process.env.EXPO_PUBLIC_APP_ENV");
    expect(sentry).toContain("sentryReleaseTags(");
    expect(sentry).toContain("enabled: !__DEV__");
    expect(sentry).toContain("sendDefaultPii: false");
    expect(sentry).toContain("...sentryRelease()");
  });

  it("Policy: Send crash reports is off by default (opt-in), gates init and stops sending when turned off", () => {
    expect(CRASH_REPORTS_DEFAULT_ON).toBe(false);
    expect(crashReportsEnabledFrom(null)).toBe(false);
    expect(crashReportsEnabledFrom(undefined)).toBe(false);
    expect(crashReportsEnabledFrom("1")).toBe(true);
    expect(crashReportsEnabledFrom("0")).toBe(false);
    expect(CRASH_REPORTS_COPY.label).toBe("Send crash reports");
    expect(pregradeCopyViolations(CRASH_REPORTS_COPY.note)).toEqual([]);
    // Off: close the client, and beforeSend drops anything still queued.
    expect(sentry).toMatch(/if \(!next\) \{[\s\S]*client\?\.close\(\)/);
    expect(sentry).toContain("if (!crashReportsOn) return null;");
    expect(sentry).toMatch(/captureMobileException[\s\S]*if \(!crashReportsOn/);
    // The preference is read before init at app start.
    expect(read("apps/mobile/app/_layout.tsx")).toContain("void loadCrashReportsPreference().then(() => initMobileSentry());");
    expect(read("apps/mobile/app/settings.tsx")).toContain('router.push("/crash-reports")');
    const screen = read("apps/mobile/app/crash-reports.tsx");
    expect(screen).toContain("setCrashReportsEnabled(next)");
    expect(screen).toContain("<Switch");
    expect(read("apps/mobile/app/_layout.tsx")).toContain('name="crash-reports"');
  });

  it("keeps the existing rule: crash reports don't depend on the analytics opt-in (documented)", () => {
    expect(sentry).not.toMatch(/isAnalyticsEnabled|loadAnalyticsPreference/);
    expect(read("docs/SENTRY.md")).toMatch(/not\*\* tied to the in-app analytics opt-in/);
    expect(read("packages/shared/src/crash-reports.ts")).toContain("independent of the analytics opt-in");
    expect(read("packages/shared/src/crash-reports.ts")).toContain("Off by default (opt-in)");
  });

  it("scrubs bearer tokens, secret query params and local photo URIs", () => {
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

  it("Dev Ops: scrubs X-CardFlow-App-Key and any *token/*secret/*password/*apiKey key (camel or snake)", () => {
    const event = scrubSentryEvent({
      request: { url: "https://api.example.com/v1/scans", headers: { "X-CardFlow-App-Key": "appkey-123", "x-refresh-token": "rt-123", Accept: "application/json" } },
      extra: {
        accessToken: "at-1",
        refresh_token: "rt-1",
        clientSecret: "cs-1",
        apiKey: "ak-1",
        posthog_api_key: "ak-2",
        userPassword: "pw-1",
        monkey: "kept",
        tokenCount: 3,
      },
    }) as { request: { headers: Record<string, unknown> }; extra: Record<string, unknown> };
    expect(event.request.headers["X-CardFlow-App-Key"]).toBe(REDACTED_VALUE);
    expect(event.request.headers["x-refresh-token"]).toBe(REDACTED_VALUE);
    expect(event.request.headers.Accept).toBe("application/json");
    for (const key of ["accessToken", "refresh_token", "clientSecret", "apiKey", "posthog_api_key", "userPassword"]) {
      expect(event.extra[key], key).toBe(REDACTED_VALUE);
    }
    expect(event.extra.monkey).toBe("kept");
    expect(event.extra.tokenCount).toBe(3);
  });

  it("Dev Ops: catches JWT-like and base64 blobs inside longer strings", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.c2lnbmF0dXJlLXNpZ25hdHVyZQ";
    const blob = "A".repeat(40) + "b".repeat(40) + "Zz09+/" + "q".repeat(20);
    const event = scrubSentryEvent({
      message: `request failed: session ${jwt} rejected`,
      exception: { values: [{ value: `bad image payload ${blob}== at upload` }] },
    }) as Record<string, unknown>;
    const json = JSON.stringify(event);
    expect(json).not.toContain(jwt);
    expect(json).not.toContain(blob);
    expect(json).toContain("request failed: session");
    expect(json).toContain(REDACTED_TOKEN);
    expect(json).toContain(REDACTED_BLOB);
    // Ordinary text, UUIDs and stack frames survive.
    const plain = scrubSentryEvent({ message: "Scan 11111111-1111-1111-1111-111111111111 failed at app/(tabs)/scan.tsx:42" }) as { message: string };
    expect(plain.message).toBe("Scan 11111111-1111-1111-1111-111111111111 failed at app/(tabs)/scan.tsx:42");
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

  it("Backend H1: 410 and 401 still wipe the phone; 403 and errors don't", () => {
    expect(accountDeletionOutcome(200)).toBe("deleted");
    expect(accountDeletionOutcome(410, "account_deleted")).toBe("already_deleted");
    expect(accountDeletionOutcome(401)).toBe("signed_out");
    expect(accountDeletionOutcome(403, "password_required")).toBe("password_required");
    expect(accountDeletionOutcome(403, "password_incorrect")).toBe("password_incorrect");
    expect(accountDeletionOutcome(403, "signup_required")).toBe("failed");
    expect(accountDeletionOutcome(500)).toBe("failed");
    expect(accountDeletionOutcome(429)).toBe("failed");
    for (const o of ["deleted", "already_deleted", "signed_out"] as const) expect(wipesPhone(o)).toBe(true);
    for (const o of ["password_required", "password_incorrect", "failed"] as const) expect(wipesPhone(o)).toBe(false);
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

  it("Backend M2: grade photo files go before the grade flow resets, history before sign-out", () => {
    const order = [...LOCAL_ACCOUNT_WIPE_STEPS] as string[];
    expect(order.indexOf("grade_photos")).toBeGreaterThan(-1);
    expect(order.indexOf("grade_photos")).toBeLessThan(order.indexOf("grade_flow"));
    expect(order.indexOf("grade_history")).toBeLessThan(order.indexOf("session"));
    expect(
      gradeFlowPhotoUris({
        front: { uri: "file:///c/Camera/a.jpg", cropUri: "file:///c/ImageManipulator/a.jpg" },
        back: { uri: "file:///c/Camera/b.jpg", cropUri: null },
        freezeUri: "file:///c/Camera/a.jpg",
      }),
    ).toEqual(["file:///c/Camera/a.jpg", "file:///c/ImageManipulator/a.jpg", "file:///c/Camera/b.jpg"]);
    expect(gradeFlowPhotoUris({ front: null, back: null, freezeUri: null })).toEqual([]);
    // reset() alone only clears memory, so the files are deleted explicitly.
    expect(read("packages/shared/src/grade-flow-resilience.ts")).not.toMatch(/reset\(\)[\s\S]{0,80}delete/);
    expect(legacyGradeHistoryKey("acct_1", "inv/2")).toBe("cardflow.gradehist.acct_1.inv_2");
    expect(read("apps/mobile/lib/grade-history.ts")).toContain("return legacyGradeHistoryKey(peekActiveUserId(), inventoryItemId);");
  });

  it("the app collects what it needs, deletes on the server, then wipes the phone", () => {
    const lib = read("apps/mobile/lib/account-deletion.ts");
    const serverCall = lib.indexOf("await deleteAccount(password)");
    expect(serverCall).toBeGreaterThan(0);
    expect(lib.indexOf("await inventoryItemIdsForWipe(userId)")).toBeLessThan(serverCall);
    expect(lib.indexOf("gradeFlowPhotoUris(gradeFlowSession.getState())")).toBeLessThan(serverCall);
    expect(lib.indexOf("if (!wipesPhone(outcome))")).toBeGreaterThan(serverCall);
    expect(lib.indexOf("runLocalAccountWipe(")).toBeGreaterThan(lib.indexOf("if (!wipesPhone(outcome))"));
    for (const step of LOCAL_ACCOUNT_WIPE_STEPS) expect(lib).toContain(`${step}:`);
    expect(read("apps/mobile/lib/api.ts")).toContain("callApi(apiContract.deleteAccountPhotos, { body: password ? { password } : {} })");
    const screen = read("apps/mobile/app/delete-account.tsx");
    expect(screen).toContain("deleteAccountEverywhere(needsPassword ? password : undefined)");
    expect(screen).toContain("isAccountDeletionConfirmed(typed)");
    expect(screen).toContain("secureTextEntry");
    expect(screen).toContain("isPasswordAccountSession()");
    expect(screen).toContain('style: "destructive"');
    expect(screen).toContain("setError(c.failed)");
    expect(screen).toContain("{c.localFailed}");
    expect(screen).toContain("{c.subscription}");
    expect(screen).toContain("{c.credits}");
    expect(screen).not.toMatch(/caught\.message|error\.message/);
    expect(read("apps/mobile/app/settings.tsx")).toContain('router.push("/delete-account")');
    expect(read("apps/mobile/app/_layout.tsx")).toContain('name="delete-account"');
  });

  it("Policy + Backend M3: exact deletion lines", () => {
    expect(POKECOLLECTOR_DELETION_LINE).toBe(
      "If your account was linked to PokéCollector, PokeSniper removes the link and deletes the cards and wishlist it stored there. This can take up to 2 weeks, and PokéCollector's own backups may keep a copy for a while.",
    );
    expect(ACCOUNT_DELETION_COPY.deletes).toContain(POKECOLLECTOR_DELETION_LINE);
    expect(ANONYMOUS_LEDGER_LINE).toBe("PokeSniper keeps only anonymous totals that can't identify you. Purchases you made on a marketplace aren't affected.");
    expect(ACCOUNT_DELETION_COPY.keeps).toBe(ANONYMOUS_LEDGER_LINE);
    expect(ACCOUNT_DELETION_COPY.subscription).toBe(
      "Deleting your account doesn't cancel an App Store or Google Play subscription. Cancel it in your store settings.",
    );
    expect(ACCOUNT_DELETION_COPY.credits).toBe("Unused grading credits are lost and can't be refunded or restored.");
  });

  it("Backend re-review M2: the wipe's item IDs come from the phone's own index, not only the server", () => {
    const index = read("apps/mobile/lib/device-item-index.ts");
    expect(index).toContain("export function rememberDeviceItemIds");
    expect(index).toContain("export function forgetDeviceItemIds");
    expect(index).not.toContain("expo-secure-store");
    const lib = read("apps/mobile/lib/account-deletion.ts");
    expect(lib).toContain("new Set(deviceItemIds(userId))");
    // listInventory may fail (401 on a retry); the device index is used either way.
    expect(lib.indexOf("deviceItemIds(userId)")).toBeLessThan(lib.indexOf("await listInventory()"));
    expect(read("apps/mobile/lib/api.ts")).toContain("rememberDeviceItemIds(result.items.map((item) => item.inventoryItemId))");
    expect(read("apps/mobile/lib/identity.ts")).toContain("setDeviceItemIndexOwner(cachedUserId)");
    const history = read("apps/mobile/lib/grade-history.ts");
    expect(history).toContain("rememberDeviceItemIds([inventoryItemId])");
    expect(history).toContain("forgetDeviceItemIds(userId)");
  });

  it("Backend re-review L1: index in the cache dir (not backed up), per-key deletes, cleared after the wipe", () => {
    const index = read("apps/mobile/lib/device-item-index.ts");
    expect(index).toContain("new File(Paths.cache, INDEX_FILE)");
    expect(index).toContain("export const MAX_IDS_PER_USER = 5000;");
    // The old document-directory file is moved once.
    expect(index).toContain("legacy.delete()");
    expect(index).toContain('if (owner === userId) owner = "";');
    expect(index).toContain("export function stopRecordingDeviceItemIds");
    const history = read("apps/mobile/lib/grade-history.ts");
    const loop = history.slice(history.indexOf("export async function clearLegacyGradeHistory"), history.indexOf("async function readLegacy"));
    expect(loop.indexOf("try {")).toBeLessThan(loop.indexOf("SecureStore.deleteItemAsync(key)"));
    expect(loop).toContain("failures += 1");
    const lib = read("apps/mobile/lib/account-deletion.ts");
    const wipe = lib.indexOf("await runLocalAccountWipe(");
    expect(lib.indexOf("stopRecordingDeviceItemIds(userId)")).toBeLessThan(wipe);
    expect(lib.lastIndexOf("forgetDeviceItemIds(userId)")).toBeGreaterThan(wipe);
  });

  it("Backend final review R5: the index entry stays when any grade-history delete failed", () => {
    const history = read("apps/mobile/lib/grade-history.ts");
    const fn = history.slice(history.indexOf("export async function clearLegacyGradeHistory"), history.indexOf("async function readLegacy"));
    // The throw on failure comes before the forget, so a failed key keeps its ID for a retry.
    expect(fn.indexOf("if (failures > 0) throw")).toBeGreaterThan(-1);
    expect(fn.indexOf("if (failures > 0) throw")).toBeLessThan(fn.indexOf("forgetDeviceItemIds(userId)"));
    const lib = read("apps/mobile/lib/account-deletion.ts");
    const after = lib.slice(lib.indexOf("await runLocalAccountWipe("));
    expect(after).toContain('if (!failed.includes("grade_history"))');
    expect(after.indexOf('if (!failed.includes("grade_history"))')).toBeLessThan(after.indexOf("forgetDeviceItemIds(userId)"));
  });

  it("H2: the anonymous-totals line is accurate (weekly totals table, ledger rows hard-deleted)", () => {
    const app = read("apps/api/src/app.ts");
    expect(app).toContain("store.accounts.deleteAllUserRows(userId, { northStarTotals, pokecollectorRemote })");
    expect(app).toContain("totals: store.accounts.listNorthStarTotals()");
    expect(app).not.toContain("anonymizeUser");
    expect(read("apps/api/drizzle/0022_north_star_weekly_totals.sql")).toContain("CREATE TABLE `north_star_weekly_totals`");
  });

  it("deletion copy follows the copy rules", () => {
    const all = [...Object.values(ACCOUNT_DELETION_COPY).flat()];
    for (const text of all) {
      expect(pregradeCopyViolations(text), text).toEqual([]);
      expect(text, text).not.toMatch(/Could not|\bCollection\b/);
    }
  });
});

describe("P4: docs from the Policy and Dev Ops reviews", () => {
  it("privacy draft: PokéCollector, anonymous totals, backups 14 days, Sentry as a provider", () => {
    const draft = read("docs/USER_CONSENT_DRAFT.md");
    expect(draft).toContain(POKECOLLECTOR_DELETION_LINE);
    expect(draft).toContain(ANONYMOUS_LEDGER_LINE);
    expect(draft).toContain("Deleted data is removed from backups within 14 days.");
    expect(draft).toContain("**Sentry** (Functional Software, Inc.)");
    expect(draft).toContain("Settings > Send crash reports");
    expect(draft).toContain("Crash reports are off by default");
  });

  it("store labels: Apple Crash Data and Play Crash logs", () => {
    const labels = read("docs/STORE_PRIVACY_LABELS.md");
    expect(labels).toMatch(/Diagnostics > Crash Data.*App Functionality.*not linked.*not used for tracking/i);
    expect(labels).toMatch(/App info and performance > Crash logs.*collected.*not shared/i);
  });

  it("RELEASE_ENV: Sentry dashboard steps, DPA, sensitive note, Ultralytics, iOS blocked, 18+", () => {
    const doc = read("docs/RELEASE_ENV.md");
    for (const needle of [
      "Prevent Storing of IP Addresses",
      "Data Scrubber",
      "Data Processing Addendum",
      "only hides the value in EAS logs",
      "CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED",
      "Android preview",
      "App Store Connect",
      "18+",
    ]) {
      expect(doc, needle).toContain(needle);
    }
  });

  it("APP_REVIEW_NOTES tracks the Play web deletion page; SIGN_IN_WITH_APPLE ships revoke with it", () => {
    expect(read("docs/APP_REVIEW_NOTES.md")).toMatch(/TODO.*Google Play.*web.*deletion/i);
    expect(read("docs/SIGN_IN_WITH_APPLE.md")).toMatch(/revoke.*must ship (together|in the same release)/i);
  });
});

describe("P4: Sign in with Apple is off by default (server env flag, Sean Oct 19)", () => {
  it("is off unless configured, and documented", () => {
    expect(SIGN_IN_WITH_APPLE.enabled).toBe(false);
    expect(signInWithAppleAvailable({ platform: "ios" })).toBe(false);
    const doc = read("docs/SIGN_IN_WITH_APPLE.md");
    expect(doc).toContain("Apple Developer account");
    expect(doc).toContain("4.8");
    // Built on /v1/sessions/social, gated by CARD_FLOW_APPLE_SIGNIN (off by default).
    expect(read("apps/api/src/social-auth.ts")).toContain("CARD_FLOW_APPLE_SIGNIN");
    expect(read("apps/api/src/app.ts")).not.toContain("/v1/sessions/apple");
  });
});
