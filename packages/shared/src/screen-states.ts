/**
 * P5 UX polish: one set of empty / loading / error states for every main
 * screen (Scan, Grade, MyDEX, Collection, Settings, Sign-up / Verify email).
 * Plain copy, one retry label, and separate offline, can't-reach, timeout,
 * busy and server-error messages. Pure functions; the app's
 * components/ui/screen-state.tsx renders them.
 */
import { ACCOUNT_AUTH_COPY } from "./account-auth";
import { AGE_CONFIRMATION_REQUIRED_CODE, AGE_GATE_COPY } from "./age-gate";
import { CARD_FLOW_UNREACHABLE_MESSAGE } from "./cardflow-http-error";
import { EMAIL_UNVERIFIED_CODE, EMAIL_VERIFICATION_COPY } from "./email-verification";
import { GRADE_QUOTA_COPY, type GradeQuotaSnapshot } from "./grade-quota";
import { GUEST_SIGNUP_COPY, SIGNUP_REQUIRED_CODE, signupMessage, type SignupReason } from "./guest-access";
import { PHOTO_PICKER_UNAVAILABLE_COPY } from "./permission-copy";
import {
  CREDIT_PACK_COPY,
  isPremiumFeature,
  PREMIUM_FEATURES,
  PREMIUM_PLACEHOLDER_PRICING,
  PREMIUM_PROMPT_COPY,
  PREMIUM_REQUIRED_CODE,
  premiumFeatureLine,
} from "./premium";
import { resetDateLabel } from "./quota-period";

export const SCREEN_STATE_COPY = {
  retry: "Try again",
  retrying: "Trying again…",
  loading: "Loading…",
  /** UX review P1-1: shown under a skeleton or spinner after `slowAfterMs`. */
  stillWorking: "Still working…",
  offlineTitle: "You're offline",
  offlineBody: "Check your connection, then try again.",
  unreachableTitle: "Can't reach PokeSniper",
  unreachableBody: "Your connection looks fine. PokeSniper may be down for a moment. Try again shortly.",
  timeoutTitle: "That took too long",
  timeoutBody: "PokeSniper didn't answer in time. Try again.",
  busyTitle: "PokeSniper is busy",
  busyBody: "Too many requests right now. Try again in a moment.",
  serverTitle: "Something went wrong on our end",
  serverBody: "It's not you. Try again in a moment.",
  authTitle: "Sign in again",
  authBody: "Your session ended. Sign in, then try again.",
  signIn: "Sign in",
  unknownBody: "Try again. If it keeps happening, check Settings for PokeSniper's status.",
  /** Community review: the Livestream page failing never touches the marketplace. */
  livePageMarketplaceNote: "The marketplace itself isn't affected.",
  /** Community review 2: known 403s get their own copy, never server text. */
  emailUnverifiedTitle: "Verify your email first",
  emailUnverifiedBody: "Verify your email to get pre-grade estimates.",
  verifyEmail: "Verify email",
  signupTitle: "Sign up to use this",
  signupBody: "Sign up to use this.",
  signUp: "Sign up",
  premiumTitle: "Part of Premium",
  ageTitle: "Confirm your age",
  quotaTitle: "No pre-grade estimates left",
  notNow: "Not now",
} as const;

/**
 * Today's visible tab label for the owned-cards screen. Sean is choosing the final name;
 * when he does, change it here (copy that names the destination reads from this).
 */
export const COLLECTION_DESTINATION_NAME = "MyDEX";

/** Community review 4: a failed Purchased tap never sounds like the real purchase failed. */
export const PURCHASED_SAVE_FAILED_COPY = `Not saved. Your marketplace purchase isn't affected. Check ${COLLECTION_DESTINATION_NAME}, then tap Purchased again.`;

const ACCOUNT_STEP_KINDS: ReadonlySet<LoadErrorKind> = new Set<LoadErrorKind>([
  "auth",
  "email_unverified",
  "signup_required",
  "premium_required",
  "age_required",
]);

/**
 * Community review 4: a failed Purchased tap (MyDEX, Decide, Livestream). Account steps keep
 * their own copy; every other failure says it wasn't saved and the real purchase is fine.
 */
export function purchasedFailureMessage(error: unknown, connected: boolean | null = null): string {
  if (ACCOUNT_STEP_KINDS.has(classifyLoadError(error, connected))) {
    return actionErrorMessage(error, PURCHASED_SAVE_FAILED_COPY, connected);
  }
  return PURCHASED_SAVE_FAILED_COPY;
}

/** UX review P1-4: Scan's session-ended line. */
export const SCAN_SESSION_ENDED_COPY = "Your session ended. Sign in, then take the photo again.";

/** UX review P1-6: a failed status check is information, not a user error. */
export const SETTINGS_STATUS_COPY = {
  checkFailed: "Couldn't check PokeSniper's status. Try again.",
  retryLabel: "Check PokeSniper's status again",
} as const;

export type LoadErrorKind =
  | "offline"
  | "unreachable"
  | "timeout"
  | "busy"
  | "quota"
  | "server"
  | "auth"
  | "email_unverified"
  | "signup_required"
  | "premium_required"
  | "age_required"
  | "unknown";

/** What the app knows about a failed call: the api.ts error fields, plus NetInfo when available. */
export interface LoadErrorInput {
  unreachable?: boolean;
  status?: number;
  message?: string;
  /** The server's machine code (`code`, or a snake_case `error`), set by api.ts. */
  code?: string;
  quota?: Partial<GradeQuotaSnapshot>;
  retryAfterSeconds?: number;
  emailUnverified?: boolean;
  signupRequired?: SignupReason;
  premiumRequired?: string;
  /** Set by api.ts only when the API marked the message `userFacing: true`. */
  userMessage?: string;
}

/** The API's out-of-allowance code (429 with a quota snapshot). Not a rate limit. */
export const OUT_OF_GRADES_CODE = "out_of_grades" as const;

function asInput(error: unknown): LoadErrorInput {
  return (error && typeof error === "object" ? error : {}) as LoadErrorInput;
}

export function classifyLoadError(error: unknown, connected: boolean | null = null): LoadErrorKind {
  const e = asInput(error);
  const unreachable =
    e.unreachable === true ||
    (typeof e.message === "string" && e.message.startsWith(CARD_FLOW_UNREACHABLE_MESSAGE));
  if (connected === false) return "offline";
  if (unreachable) return connected === true ? "unreachable" : "offline";
  const status = typeof e.status === "number" ? e.status : null;
  const code = typeof e.code === "string" ? e.code : null;
  if (e.emailUnverified === true || code === EMAIL_UNVERIFIED_CODE) return "email_unverified";
  if (e.signupRequired != null || code === SIGNUP_REQUIRED_CODE) return "signup_required";
  if (e.premiumRequired != null || code === PREMIUM_REQUIRED_CODE) return "premium_required";
  if (code === AGE_CONFIRMATION_REQUIRED_CODE) return "age_required";
  // Allowance used up: its own copy. Only a 429 without a quota is a real rate limit.
  if (code === OUT_OF_GRADES_CODE || (status === 429 && e.quota != null)) return "quota";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "busy";
  // UX review P2-1: the grader queue answers 503 + Retry-After when it's busy.
  if (status === 503 && typeof e.retryAfterSeconds === "number") return "busy";
  if (status === 401) return "auth";
  if (status != null && status >= 500) return "server";
  return "unknown";
}

/** "Try again in about 30 s." when the server said how long; the generic line otherwise. */
export function busyBody(retryAfterSeconds?: number | null): string {
  if (typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    const s = Math.ceil(retryAfterSeconds);
    return s < 90 ? `Too many requests right now. Try again in about ${s} s.` : `Too many requests right now. Try again in about ${Math.round(s / 60)} min.`;
  }
  return SCREEN_STATE_COPY.busyBody;
}

/**
 * Community review 1: "You've used all N pre-grade estimates for this period. Your allowance
 * resets on Nov 3." plus Premium or credit wording where it applies. Never says "busy".
 */
export function quotaExhaustedMessage(quota?: Partial<GradeQuotaSnapshot> | null, options: { timeZone?: string } = {}): string {
  const limit = typeof quota?.monthlyLimit === "number" ? Math.max(0, Math.floor(quota.monthlyLimit)) : null;
  const first =
    limit != null && limit > 0
      ? `You've used all ${limit} pre-grade estimate${limit === 1 ? "" : "s"} for this period.`
      : "You've used all your pre-grade estimates for this period.";
  const reset = typeof quota?.resetsAt === "string" ? resetDateLabel(quota.resetsAt, options).replace(/^Resets /, "") : "";
  const second = reset ? `Your allowance resets on ${reset}.` : "Your allowance resets on your reset date.";
  const lines = [first, second];
  if (quota?.plan === "free") {
    lines.push(`Premium will include unlimited quick estimates. ${PREMIUM_PROMPT_COPY.notYet}`);
  }
  if (quota?.iapEnabled === true) lines.push(CREDIT_PACK_COPY.neverExpire);
  return lines.join(" ");
}

function premiumLine(feature: unknown): string {
  return isPremiumFeature(feature) ? premiumFeatureLine(feature) : "This is part of Premium.";
}

export interface LoadErrorCopy {
  kind: LoadErrorKind;
  title: string;
  body: string;
}

/**
 * Full-screen error copy. `what` names the thing that didn't load, in
 * lower case ("your collection"), and is used for the generic title.
 */
export function loadErrorCopy(error: unknown, what: string, connected: boolean | null = null): LoadErrorCopy {
  const kind = classifyLoadError(error, connected);
  const e = asInput(error);
  const c = SCREEN_STATE_COPY;
  switch (kind) {
    case "offline":
      return { kind, title: c.offlineTitle, body: c.offlineBody };
    case "unreachable":
      return { kind, title: c.unreachableTitle, body: c.unreachableBody };
    case "timeout":
      return { kind, title: c.timeoutTitle, body: c.timeoutBody };
    case "busy":
      return { kind, title: c.busyTitle, body: busyBody(e.retryAfterSeconds) };
    case "quota":
      return { kind, title: c.quotaTitle, body: quotaExhaustedMessage(e.quota) };
    case "server":
      return { kind, title: c.serverTitle, body: c.serverBody };
    case "auth":
      return { kind, title: c.authTitle, body: c.authBody };
    case "email_unverified":
      return { kind, title: c.emailUnverifiedTitle, body: c.emailUnverifiedBody };
    case "signup_required":
      return { kind, title: c.signupTitle, body: e.signupRequired ? signupMessage(e.signupRequired) : c.signupBody };
    case "premium_required":
      return { kind, title: c.premiumTitle, body: `${premiumLine(e.premiumRequired)} ${PREMIUM_PROMPT_COPY.notYet}` };
    case "age_required":
      return { kind, title: c.ageTitle, body: AGE_GATE_COPY.required };
    default:
      return { kind, title: `Couldn't load ${what}`, body: c.unknownBody };
  }
}

/** The way out for an error: a primary action that fixes it, when there is one. */
export interface ErrorAction {
  label: string;
  href: "/verify-email" | "/sign-up" | "/sign-up?mode=sign_in";
}

export function errorAction(error: unknown, connected: boolean | null = null): ErrorAction | null {
  const kind = classifyLoadError(error, connected);
  if (kind === "auth") return { label: SCREEN_STATE_COPY.signIn, href: "/sign-up?mode=sign_in" };
  if (kind === "email_unverified") return { label: SCREEN_STATE_COPY.verifyEmail, href: "/verify-email" };
  if (kind === "signup_required") return { label: SCREEN_STATE_COPY.signUp, href: "/sign-up" };
  return null;
}

/**
 * Messages the app may show as-is because PokeSniper wrote them for people. Anything else
 * (provider text, "Job not found", "Network request failed", JSON or zod output) is never shown.
 */
const KNOWN_USER_MESSAGES: ReadonlySet<string> = new Set<string>([
  ...Object.values(ACCOUNT_AUTH_COPY),
  EMAIL_VERIFICATION_COPY.required,
  EMAIL_VERIFICATION_COPY.invalid,
  EMAIL_VERIFICATION_COPY.tooSoon,
  EMAIL_VERIFICATION_COPY.sendLimit,
  EMAIL_VERIFICATION_COPY.dailyLimit,
  GUEST_SIGNUP_COPY.body,
  AGE_GATE_COPY.required,
  PHOTO_PICKER_UNAVAILABLE_COPY,
  GRADE_QUOTA_COPY.iapUnavailable,
  ...PREMIUM_FEATURES.map((f) => premiumFeatureLine(f)),
]);

export function isKnownUserMessage(message: unknown): message is string {
  return typeof message === "string" && KNOWN_USER_MESSAGES.has(message.trim());
}

/**
 * One-line message for a failed action (save, sign in, scan). Known kinds and codes get the
 * shared copy. Otherwise the text is shown only if it's on the allowlist above or the API
 * marked it user-facing; everything else gets the caller's fallback. Never raw Error.message.
 */
export function actionErrorMessage(error: unknown, fallback: string, connected: boolean | null = null): string {
  const kind = classifyLoadError(error, connected);
  const e = asInput(error);
  const c = SCREEN_STATE_COPY;
  switch (kind) {
    case "offline":
      return `${c.offlineTitle}. ${c.offlineBody}`;
    case "unreachable":
      return `${c.unreachableTitle}. Try again shortly.`;
    case "timeout":
      return c.timeoutBody;
    case "busy":
      return `${c.busyTitle}. ${busyBody(e.retryAfterSeconds).replace(/^Too many requests right now\. /, "")}`;
    case "quota":
      return quotaExhaustedMessage(e.quota);
    case "server":
      return `${c.serverTitle}. Try again in a moment.`;
    case "auth":
      return c.authBody;
    case "email_unverified":
      return c.emailUnverifiedBody;
    case "signup_required":
      return c.signupBody;
    case "premium_required":
      return premiumLine(e.premiumRequired);
    case "age_required":
      return AGE_GATE_COPY.required;
    default:
      break;
  }
  if (typeof e.userMessage === "string" && e.userMessage.trim()) return e.userMessage.trim();
  if (isKnownUserMessage(e.message)) return e.message.trim();
  return fallback;
}

/**
 * UX review P0-1: what a data screen shows. A failure after a successful load keeps the data
 * ("stale", with a banner); only a failure with nothing loaded takes over the screen.
 */
export type ScreenDataState = "loading" | "error" | "stale" | "ready";

export function screenDataState(input: { status: "loading" | "ready" | "error"; loadedAt: number | null }): ScreenDataState {
  if (input.status === "error") return input.loadedAt == null ? "error" : "stale";
  if (input.status === "loading") return input.loadedAt == null ? "loading" : "ready";
  return "ready";
}

/** "a moment ago", "5 minutes ago", "2 hours ago", "yesterday", "3 days ago". */
export function relativeTimeLabel(thenMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (seconds < 60) return "a moment ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** UX review P0-1 banner copy. Collection keeps the spec's price wording. */
export function staleBannerCopy(kind: "generic" | "prices", loadedAt: number, nowMs: number): string {
  const when = relativeTimeLabel(loadedAt, nowMs);
  return kind === "prices"
    ? `Couldn't update prices. Showing values from ${when}.`
    : `Couldn't update. Showing what you had from ${when}.`;
}

/** UX review P1-1: "Still working…" after 8 s (Scan and lists) or 20 s (Grade estimate). */
export const SLOW_LOADING_MS = { default: 8000, gradeEstimate: 20000 } as const;

/** Calls `onSlow` once after `slowAfterMs`; returns a cancel. Pure, so it's tested with fake timers. */
export function startSlowTimer(slowAfterMs: number, onSlow: () => void): () => void {
  if (!(slowAfterMs > 0) || !Number.isFinite(slowAfterMs)) return () => {};
  const timer = setTimeout(onSlow, slowAfterMs);
  return () => clearTimeout(timer);
}

/** Grade photo pre-grade, 404 (UX review P0-3): exact copy, no score. */
export const GRADE_ESTIMATE_NOT_FOUND_COPY = "Photo pre-grade is not available yet. Mark defects still works.";

/** Message for a failed photo pre-grade request: 404 has fixed copy; nothing raw. */
export function pregradeFailureMessage(error: unknown, fallback: string, connected: boolean | null = null): string {
  if (asInput(error).status === 404) return GRADE_ESTIMATE_NOT_FOUND_COPY;
  return actionErrorMessage(error, fallback, connected);
}

/** Empty states, one voice. Each says what's missing and the next step. */
export const SCREEN_EMPTY_COPY = {
  noMatches: { title: "No matching cards", body: "Try a different name or number." },
  collectionPurchased: {
    title: "No cards yet",
    body: `Scan a card, confirm it, then mark it Purchased to start tracking its value in ${COLLECTION_DESTINATION_NAME}.`,
    action: "Scan a card",
  },
  collectionWatchlist: {
    title: "Nothing on your watchlist",
    body: "Scan and confirm a card, then tap Watchlist.",
    action: "Scan a card",
  },
  gradePrepare: {
    title: "No purchased copies yet",
    body: "Scan and confirm a card, then mark it Purchased.",
    action: `Open ${COLLECTION_DESTINATION_NAME}`,
  },
  gradePrepareDone: { title: "No copies left to prepare", body: "Copies you've moved are under Submitted or Returned." },
  gradeSubmitted: { title: "Nothing submitted", body: "Prepare a purchased copy first." },
  gradeReturned: { title: "Nothing returned yet", body: "Copies you mark Returned show up here." },
} as const;

/** Screen-reader labels for the loading skeletons. */
export const SCREEN_LOADING_LABELS = {
  collection: `Loading ${COLLECTION_DESTINATION_NAME}`,
  grade: "Loading your copies",
  settings: "Checking connection",
  livePage: "Loading the live page",
} as const;

/** What each main screen calls its content in the generic error title. */
export const SCREEN_ERROR_WHAT = {
  collection: COLLECTION_DESTINATION_NAME,
  grade: "your copies",
  livePage: "the live page",
} as const;
