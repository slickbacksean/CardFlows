import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CARD_FLOW_UNREACHABLE_MESSAGE } from "./cardflow-http-error";
import { pregradeCopyViolations } from "./pregrade-copy";
import { ACCOUNT_AUTH_COPY } from "./account-auth";
import { AGE_CONFIRMATION_REQUIRED_CODE, AGE_GATE_COPY } from "./age-gate";
import { EMAIL_VERIFICATION_COPY, verifyEmailIntro } from "./email-verification";
import { premiumFeatureLine, PREMIUM_PROMPT_COPY } from "./premium";
import {
  actionErrorMessage,
  busyBody,
  classifyLoadError,
  COLLECTION_DESTINATION_NAME,
  errorAction,
  GRADE_ESTIMATE_NOT_FOUND_COPY,
  loadErrorCopy,
  pregradeFailureMessage,
  PURCHASED_SAVE_FAILED_COPY,
  purchasedFailureMessage,
  quotaExhaustedMessage,
  relativeTimeLabel,
  SCAN_SESSION_ENDED_COPY,
  SCREEN_EMPTY_COPY,
  SCREEN_ERROR_WHAT,
  SCREEN_LOADING_LABELS,
  SCREEN_STATE_COPY,
  screenDataState,
  SETTINGS_STATUS_COPY,
  SLOW_LOADING_MS,
  staleBannerCopy,
  startSlowTimer,
} from "./screen-states";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MOBILE = path.join(REPO, "apps/mobile");
const read = (p: string) => readFileSync(path.join(MOBILE, p), "utf8");

const httpError = (status: number, message = "x") => Object.assign(new Error(message), { status });
const unreachable = () => Object.assign(new Error(`${CARD_FLOW_UNREACHABLE_MESSAGE} http://api`), { unreachable: true });

describe("P5 screen states: error classification", () => {
  it("tells offline, can't-reach, timeout, busy, server, auth and other apart", () => {
    expect(classifyLoadError(unreachable())).toBe("offline");
    expect(classifyLoadError(unreachable(), false)).toBe("offline");
    expect(classifyLoadError(unreachable(), true)).toBe("unreachable");
    expect(classifyLoadError(new Error(CARD_FLOW_UNREACHABLE_MESSAGE), true)).toBe("unreachable");
    expect(classifyLoadError(httpError(500), false)).toBe("offline");
    expect(classifyLoadError(httpError(504))).toBe("timeout");
    expect(classifyLoadError(httpError(408))).toBe("timeout");
    expect(classifyLoadError(httpError(429))).toBe("busy");
    expect(classifyLoadError(httpError(503))).toBe("server");
    expect(classifyLoadError(httpError(401))).toBe("auth");
    expect(classifyLoadError(httpError(403))).toBe("unknown");
    expect(classifyLoadError(null)).toBe("unknown");
    expect(classifyLoadError("weird")).toBe("unknown");
  });

  it("gives plain full-screen copy, naming what didn't load only in the generic case", () => {
    expect(loadErrorCopy(unreachable(), "your collection")).toEqual({
      kind: "offline",
      title: "You're offline",
      body: "Check your connection, then try again.",
    });
    expect(loadErrorCopy(httpError(500), "your collection", true).title).toBe("Something went wrong on our end");
    expect(loadErrorCopy(null, SCREEN_ERROR_WHAT.livePage).title).toBe("Couldn't load the live page");
    expect(SCREEN_STATE_COPY.retry).toBe("Try again");
  });

  it("action errors: shared offline/server wording, else the server's plain message, else the fallback", () => {
    expect(actionErrorMessage(unreachable(), "Couldn't save.")).toBe("You're offline. Check your connection, then try again.");
    expect(actionErrorMessage(httpError(502), "Couldn't save.")).toBe("Something went wrong on our end. Try again in a moment.");
    // Community review 3 / UX P0-3: unknown server text never passes through...
    expect(actionErrorMessage(httpError(400, "That email is already in use."), "Couldn't save.")).toBe("Couldn't save.");
    // ...only allowlisted CardFlow copy, or text the API marked user-facing.
    expect(actionErrorMessage(httpError(401, ACCOUNT_AUTH_COPY.signInFailed), "x")).toBe(SCREEN_STATE_COPY.authBody);
    expect(actionErrorMessage(httpError(400, ACCOUNT_AUTH_COPY.badEmail), "x")).toBe(ACCOUNT_AUTH_COPY.badEmail);
    expect(
      actionErrorMessage(Object.assign(httpError(409, "raw"), { userMessage: "That code was already used." }), "x"),
    ).toBe("That code was already used.");
    expect(actionErrorMessage(null, "Couldn't save.")).toBe("Couldn't save.");
  });

  it("all state copy is plain, with no estimate-rule words", () => {
    const all = [
      ...Object.values(SCREEN_STATE_COPY),
      ...Object.values(SCREEN_EMPTY_COPY).flatMap((c) => Object.values(c)),
      ...Object.values(SCREEN_LOADING_LABELS),
    ];
    for (const text of all) {
      expect(text, text).not.toMatch(/\bAI\b|PSA|BGS|CGC|market price|error code|exception|\bnull\b/i);
      expect(pregradeCopyViolations(text), text).toEqual([]);
    }
  });
});

describe("Community review: quota, 403 codes and the allowlist", () => {
  const quota = { plan: "free" as const, monthlyLimit: 5, resetsAt: "2026-11-03T12:00:00.000Z", iapEnabled: false };

  it("an empty allowance is not a rate limit", () => {
    expect(classifyLoadError(Object.assign(httpError(429), { quota }))).toBe("quota");
    expect(classifyLoadError(Object.assign(httpError(429), { code: "out_of_grades" }))).toBe("quota");
    expect(classifyLoadError(httpError(429))).toBe("busy");
    const text = quotaExhaustedMessage(quota, { timeZone: "UTC" });
    expect(text).toMatch(/^You've used all 5 pre-grade estimates for this period\. Your allowance resets on Nov 3\./);
    expect(text).toContain(PREMIUM_PROMPT_COPY.notYet);
    expect(text).not.toMatch(/busy|too many requests/i);
    expect(quotaExhaustedMessage({ ...quota, plan: "premium" }, { timeZone: "UTC" })).not.toContain("Premium will include");
    expect(quotaExhaustedMessage({ ...quota, monthlyLimit: 1 })).toContain("all 1 pre-grade estimate for");
    expect(quotaExhaustedMessage(null)).toBe(
      "You've used all your pre-grade estimates for this period. Your allowance resets on your reset date.",
    );
    expect(actionErrorMessage(Object.assign(httpError(429), { quota }), "x")).toBe(quotaExhaustedMessage(quota));
    expect(loadErrorCopy(Object.assign(httpError(429), { quota }), "w").title).toBe(SCREEN_STATE_COPY.quotaTitle);
  });

  it("known 403 codes get explicit copy, never server text", () => {
    const unverified = Object.assign(httpError(403, "raw server text"), { emailUnverified: true });
    expect(actionErrorMessage(unverified, "x")).toBe("Verify your email to get pre-grade estimates.");
    expect(errorAction(unverified)).toEqual({ label: "Verify email", href: "/verify-email" });
    const signup = Object.assign(httpError(403, "raw"), { code: "signup_required" });
    expect(actionErrorMessage(signup, "x")).toBe("Sign up to use this.");
    expect(errorAction(signup)?.label).toBe("Sign up");
    const premium = Object.assign(httpError(403, "raw"), { code: "premium_required", premiumRequired: "batch_grading" });
    expect(actionErrorMessage(premium, "x")).toBe(premiumFeatureLine("batch_grading"));
    expect(actionErrorMessage(Object.assign(httpError(403, "raw"), { code: "premium_required" }), "x")).toBe(
      "This is part of Premium.",
    );
    const age = Object.assign(httpError(400, "raw"), { code: AGE_CONFIRMATION_REQUIRED_CODE });
    expect(actionErrorMessage(age, "x")).toBe(AGE_GATE_COPY.required);
    // Any other 403 is not "auth" and not passed through.
    expect(actionErrorMessage(httpError(403, "Forbidden: tenant mismatch"), "Couldn't save.")).toBe("Couldn't save.");
  });

  it("auth errors lead with Sign in (UX P1-4); Scan's copy no longer mentions invite codes", () => {
    expect(errorAction(httpError(401))).toEqual({ label: "Sign in", href: "/sign-up?mode=sign_in" });
    expect(errorAction(httpError(500))).toBeNull();
    expect(SCAN_SESSION_ENDED_COPY).toBe("Your session ended. Sign in, then take the photo again.");
    const capture = read("app/capture.tsx");
    expect(capture).toContain("SCAN_SESSION_ENDED_COPY");
    expect(capture).not.toContain("invite code, then take the photo again");
  });

  it("503 + Retry-After is busy, with the wait when known (UX P2-1)", () => {
    expect(classifyLoadError(Object.assign(httpError(503), { retryAfterSeconds: 30 }))).toBe("busy");
    expect(classifyLoadError(httpError(503))).toBe("server");
    expect(busyBody(30)).toBe("Too many requests right now. Try again in about 30 s.");
    expect(busyBody(600)).toBe("Too many requests right now. Try again in about 10 min.");
    expect(busyBody(undefined)).toBe(SCREEN_STATE_COPY.busyBody);
  });

  it("api.ts attaches the code, the user-facing flag and Retry-After; the API marks out_of_grades", () => {
    const api = read("lib/api.ts");
    expect(api).toContain("extra.code = body.code");
    expect(api).toContain("body.userFacing === true");
    expect(api).toContain('get("retry-after")');
    expect(api).toContain("pregradeFailureMessage(extra, PREGRADE_UNAVAILABLE_MESSAGE)");
    expect(api).not.toMatch(/message: extra instanceof Error && extra\.message \? extra\.message/);
    const server = readFileSync(path.join(REPO, "apps/api/src/app.ts"), "utf8");
    expect(server).toContain('code: "out_of_grades", error: GRADE_QUOTA_COPY.outOfGrades');
  });

  it("purchased failures: plain copy, account steps kept, and duplicate guards on every Purchased path", () => {
    expect(PURCHASED_SAVE_FAILED_COPY).toBe(
      `Not saved. Your marketplace purchase isn't affected. Check ${COLLECTION_DESTINATION_NAME}, then tap Purchased again.`,
    );
    expect(purchasedFailureMessage(httpError(500))).toBe(PURCHASED_SAVE_FAILED_COPY);
    expect(purchasedFailureMessage(new TypeError("Network request failed"))).toBe(PURCHASED_SAVE_FAILED_COPY);
    expect(purchasedFailureMessage(Object.assign(httpError(403), { code: "signup_required" }))).toBe("Sign up to use this.");
    const collection = read("app/(tabs)/collection.tsx");
    expect(collection).toContain("setActionError(purchasedFailureMessage(caught))");
    expect(collection).toContain('if (item.intent === "purchased") return;');
    expect(collection).toContain("shouldAcceptLiveHudPurchaseTap");
    const decide = read("app/decide/[cardflowCardId].tsx");
    expect(decide.match(/setError\(purchasedFailureMessage\(caught\)\)/g)).toHaveLength(2);
    expect(decide.match(/purchaseInFlightRef\.current\) return;/g)?.length).toBeGreaterThanOrEqual(2);
    expect(read("app/(tabs)/scan-tab.tsx")).toContain("setPurchaseError(purchasedFailureMessage(caught))");
  });

  it('"Couldn\'t", never "Could not", in app and shared copy', () => {
    const offenders: string[] = [];
    for (const dir of [path.join(MOBILE, "app"), path.join(MOBILE, "components"), path.join(MOBILE, "lib"), path.join(REPO, "packages/shared/src")]) {
      for (const file of sourceFiles(dir)) {
        if (/Could not/.test(readFileSync(file, "utf8"))) offenders.push(path.relative(REPO, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("UX review: data, stale banner, slow loading", () => {
  afterEach(() => vi.useRealTimers());

  it("test 1: an error after a successful load keeps the items and shows the banner", () => {
    expect(screenDataState({ status: "loading", loadedAt: null })).toBe("loading");
    expect(screenDataState({ status: "error", loadedAt: null })).toBe("error");
    expect(screenDataState({ status: "error", loadedAt: 1000 })).toBe("stale");
    expect(screenDataState({ status: "loading", loadedAt: 1000 })).toBe("ready");
    expect(staleBannerCopy("generic", 0, 5 * 60_000)).toBe("Couldn't update. Showing what you had from 5 minutes ago.");
    expect(staleBannerCopy("prices", 0, 30_000)).toBe("Couldn't update prices. Showing values from a moment ago.");
    expect(relativeTimeLabel(0, 60 * 60_000)).toBe("1 hour ago");
    expect(relativeTimeLabel(0, 26 * 60 * 60_000)).toBe("yesterday");
    for (const [file, kind] of [
      ["app/(tabs)/collection.tsx", 'kind="prices"'],
      ["app/(tabs)/grading.tsx", "<StaleBanner"],
    ] as const) {
      const source = read(file);
      expect(source, file).toContain("screenDataState(");
      expect(source, file).toContain("setLoadedAt(Date.now())");
      expect(source, file).toContain(kind);
      // The full-screen error only when nothing has loaded yet.
      expect(source, file).not.toMatch(/\{loadState === "error" \? \(/);
    }
  });

  it("test 2: a Grade inventory error never unmounts PhotoGradeFlow", () => {
    const grading = read("app/(tabs)/grading.tsx");
    const photo = grading.indexOf('if (pane === "photo") {');
    const firstError = grading.indexOf("<ScreenError");
    expect(photo).toBeGreaterThan(0);
    expect(firstError).toBeGreaterThan(photo);
    // The photo pane's return depends on the pane alone, never on load state.
    expect(grading.slice(photo, grading.indexOf("\n", photo))).not.toMatch(/load|error/i);
    expect(grading).toContain("return <PhotoGradeFlow");
    // Submitted / Returned read their own grading load, and a failed one keeps the copies.
    expect(grading).toContain("Promise.allSettled");
    expect(grading).not.toContain("listGrading().catch(() => ({ submitted: [], returned: [] }))");
  });

  it("test 3: actionErrorMessage never returns non-flagged Error.message; Grade 404 has exact copy", () => {
    expect(actionErrorMessage(new TypeError("Network request failed"), "Couldn't save.")).toBe("Couldn't save.");
    expect(actionErrorMessage(new Error("Unexpected token < in JSON"), "Couldn't save.")).toBe("Couldn't save.");
    expect(actionErrorMessage(httpError(404, "Job not found"), "Couldn't save.")).toBe("Couldn't save.");
    expect(actionErrorMessage(httpError(400, "Grade jobs are off"), "Couldn't save.")).toBe("Couldn't save.");
    expect(GRADE_ESTIMATE_NOT_FOUND_COPY).toBe("Photo pre-grade is not available yet. Mark defects still works.");
    expect(pregradeFailureMessage(httpError(404, "Not Found"), "fallback")).toBe(GRADE_ESTIMATE_NOT_FOUND_COPY);
    expect(read("components/ui/photo-grade-flow.tsx")).toContain("unavailableMessage === GRADE_ESTIMATE_NOT_FOUND_COPY");
  });

  it('test 4: ScreenLoading shows "Still working…" after slowAfterMs', () => {
    vi.useFakeTimers();
    const onSlow = vi.fn();
    const cancel = startSlowTimer(SLOW_LOADING_MS.default, onSlow);
    vi.advanceTimersByTime(7999);
    expect(onSlow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSlow).toHaveBeenCalledTimes(1);
    cancel();
    const early = vi.fn();
    startSlowTimer(SLOW_LOADING_MS.gradeEstimate, early)();
    vi.advanceTimersByTime(30_000);
    expect(early).not.toHaveBeenCalled();
    expect(SLOW_LOADING_MS.gradeEstimate).toBe(20000);
    expect(SCREEN_STATE_COPY.stillWorking).toBe("Still working…");
    const component = read("components/ui/screen-state.tsx");
    expect(component).toContain("startSlowTimer(slowAfterMs");
    expect(component).toContain("SCREEN_STATE_COPY.stillWorking");
    expect(component).toContain("slowAfterMs = SLOW_LOADING_MS.default");
  });

  it("test 5: scan-tab renders ScreenError only in the load-failed branch, nothing over the live page", () => {
    const tab = read("app/(tabs)/scan-tab.tsx");
    const errorBranch = tab.indexOf('if (loadState === "error") {');
    const branchEnd = tab.indexOf("\n  }\n", errorBranch);
    expect(tab.match(/<ScreenError/g)).toHaveLength(1);
    const screenError = tab.indexOf("<ScreenError");
    expect(screenError).toBeGreaterThan(errorBranch);
    expect(screenError).toBeLessThan(branchEnd);
    // Inside the live region (the browser and its HUD layer) there are no state components.
    const live = tab.slice(tab.indexOf("style={styles.liveRegion}"));
    expect(live).not.toMatch(/<(ScreenError|InlineError|StatusBanner|ScreenLoading|StaleBanner)\b/);
    expect(tab).toContain("note={SCREEN_STATE_COPY.livePageMarketplaceNote}");
    expect(SCREEN_STATE_COPY.livePageMarketplaceNote).toMatch(/marketplace/i);
  });

  it("settings: muted info row, 48 dp labelled retry, Checking connection", () => {
    const settings = read("app/settings.tsx");
    expect(settings).toContain("<InfoRow message={stackError} />");
    expect(settings).toContain("accessibilityLabel={SETTINGS_STATUS_COPY.retryLabel}");
    expect(settings).toContain("SCREEN_LOADING_LABELS.settings");
    expect(settings).not.toContain("<InlineError");
    expect(SETTINGS_STATUS_COPY.checkFailed).toBe("Couldn't check CardFlow's status. Try again.");
    expect(SCREEN_LOADING_LABELS.settings).toBe("Checking connection");
  });

  it("sign-up says why the button is disabled; verify email says what it unlocks", () => {
    const signUp = read("app/sign-up.tsx");
    expect(signUp).toContain("AGE_GATE_COPY.disabledCaption");
    expect(signUp).toContain("AGE_GATE_COPY.disabledHint");
    expect(signUp).toContain('accessibilityRole="checkbox"');
    expect(signUp).toContain('disabled={saving || (mode === "sign_up" && !over18)}');
    expect(AGE_GATE_COPY.disabledCaption).toBe("You must be 18 or older to create an account.");
    expect(verifyEmailIntro("sam@example.com")).toBe(
      "Verify your email to get pre-grade estimates. We sent a 6-digit code to sam@example.com.",
    );
    expect(EMAIL_VERIFICATION_COPY.verified).toBe("Email verified. You can now get pre-grade estimates.");
    expect(read("app/verify-email.tsx")).toContain("EMAIL_VERIFICATION_COPY.fromPregrade");
    expect(read("app/_layout.tsx")).toContain('params: { from: "pregrade" }');
    // Estimate copy rule wins over the review's suggested "AI pre-grade" wording.
    for (const text of [verifyEmailIntro(), EMAIL_VERIFICATION_COPY.fromPregrade, EMAIL_VERIFICATION_COPY.verified, EMAIL_VERIFICATION_COPY.promptBody]) {
      expect(pregradeCopyViolations(text), text).toEqual([]);
    }
  });

  it("empty-state copy from the reviews", () => {
    expect(SCREEN_EMPTY_COPY.collectionPurchased.title).toBe("No cards yet");
    expect(SCREEN_EMPTY_COPY.collectionPurchased.body).toBe(
      "Scan a card, confirm it, then mark it Purchased to start tracking its value in MyDEX.",
    );
    // Grade's empty state keeps its own body and its "Open MyDEX" action.
    expect(SCREEN_EMPTY_COPY.gradePrepare.body).toBe("Scan and confirm a card, then mark it Purchased.");
    expect(SCREEN_EMPTY_COPY.gradePrepareDone.body).toBe("Copies you've moved are under Submitted or Returned.");
    expect(SCREEN_EMPTY_COPY.gradeReturned.body).toBe("Copies you mark Returned show up here.");
    expect(SCREEN_EMPTY_COPY.gradePrepare.action).toBe(`Open ${COLLECTION_DESTINATION_NAME}`);
    expect(SCREEN_ERROR_WHAT.collection).toBe(COLLECTION_DESTINATION_NAME);
    expect(SCREEN_STATE_COPY.unknownBody).toBe("Try again. If it keeps happening, check Settings for CardFlow's status.");
    const component = read("components/ui/screen-state.tsx");
    // P1-10: empty-state actions are primary; P1-3: focus moves to the title; P2-5: busy state.
    expect(component).toMatch(/\{action \? <PrimaryButton label=\{action\.label\} onPress=\{action\.onPress\} \/>/);
    expect(component).toContain("AccessibilityInfo.setAccessibilityFocus");
    expect(component).toContain("accessibilityState={{ busy: true }}");
    expect(component).not.toMatch(/<View accessibilityLiveRegion="polite" style=\{styles\.center\}>/);
  });
});

describe("P5 screen states: every main screen uses the shared component", () => {
  const screens: Record<string, { file: string; needs: string[] }> = {
    Scan: { file: "app/capture.tsx", needs: ["<InlineError", "actionErrorMessage("] },
    "Livestream Screener": { file: "app/(tabs)/scan-tab.tsx", needs: ["<ScreenError", "SCREEN_ERROR_WHAT.livePage"] },
    Grade: {
      file: "app/(tabs)/grading.tsx",
      needs: ["<ScreenError", "<ScreenLoading", "<ScreenEmpty", "<InlineError", "actionErrorMessage("],
    },
    MyDEX: {
      file: "app/(tabs)/collection.tsx",
      needs: ["<ScreenError", "<ScreenLoading", "<ScreenEmpty", "<InlineError", "actionErrorMessage("],
    },
    Settings: { file: "app/settings.tsx", needs: ["<InfoRow", "SCREEN_STATE_COPY.retry", "checkHealth()"] },
    "Sign-up": { file: "app/sign-up.tsx", needs: ["<InlineError", "actionErrorMessage("] },
    "Verify email": { file: "app/verify-email.tsx", needs: ["<InlineError", "actionErrorMessage("] },
  };
  for (const [name, { file, needs }] of Object.entries(screens)) {
    it(name, () => {
      const source = read(file);
      for (const needle of needs) expect(source, `${file} ${needle}`).toContain(needle);
      // No more one-off "Couldn't load …" headings or raw error.message dumps.
      expect(source).not.toMatch(/Couldn't load (inventory|the live page)/);
      expect(source).not.toMatch(/caught instanceof Error \? caught\.message/);
    });
  }

  it("the component covers offline, loading skeletons, empty and inline errors without native modules", () => {
    const component = read("components/ui/screen-state.tsx");
    expect(component).toContain("export function ScreenLoading");
    expect(component).toContain("export function ScreenEmpty");
    expect(component).toContain("export function ScreenError");
    expect(component).toContain("export function InlineError");
    expect(component).toContain('from "@react-native-community/netinfo"');
    expect(component).toContain('accessibilityRole="progressbar"');
    expect(component).not.toMatch(/Animated\.|withRepeat|react-native-reanimated/);
  });
});

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("P5 copy audit", () => {
  it("Max Buy is never called a market price", () => {
    const offenders: string[] = [];
    const files = [
      ...sourceFiles(path.join(MOBILE, "app")),
      ...sourceFiles(path.join(MOBILE, "components")),
      ...sourceFiles(path.join(REPO, "packages/shared/src")),
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      // Look at each sentence-ish chunk that mentions Max Buy.
      for (const chunk of text.split(/[.\n]/)) {
        if (!/max buy/i.test(chunk)) continue;
        if (!/market (price|value)/i.test(chunk)) continue;
        if (/\bnot\b|\bisn't\b|never/i.test(chunk)) continue;
        offenders.push(`${path.relative(REPO, file)}: ${chunk.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("estimate titles use the standing wording", () => {
    const flow = read("components/ui/photo-grade-flow.tsx");
    expect(flow).toContain("PREGRADE_LABEL");
    expect(flow).toContain("PREGRADE_DISCLAIMER");
  });
});
