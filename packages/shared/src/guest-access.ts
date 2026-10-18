/**
 * Sean (Oct 17, 8:36 PM PT): guests are **browse-only**. They can look around the app, but any
 * scan, grade or save needs sign-up first; the free account is the entry tier. This replaces
 * D9's guest scan allowance. The API enforces it with 403 `signup_required`; the app only opens
 * the sign-up prompt.
 */
import type { InvitedIdentity } from "./identity";

export const GUEST_USER_PREFIX = "guest_";
export const SIGNUP_REQUIRED_CODE = "signup_required";

/** What the guest tried (for logs and the app); every reason shows the same copy. */
export type SignupReason = "scan" | "grade" | "cardsight" | "save";

export const GUEST_SIGNUP_COPY = {
  title: "Sign up to keep going",
  body: "Sign up to scan, grade and save cards. It's free.",
  action: "Sign up",
  dismiss: "Not now",
} as const;

export function isGuestUserId(userId: string | null | undefined): boolean {
  return typeof userId === "string" && userId.startsWith(GUEST_USER_PREFIX);
}

export function guestIdentity(userId: string): InvitedIdentity {
  return { userId, label: "Guest" };
}

/** Writes a guest may make: perf telemetry, and deleting their own (session) data. */
const GUEST_WRITES = new Set(["POST /v1/telemetry/perf", "POST /v1/account/delete"]);

/**
 * Scan, grade, livestream and CardSight routes, refused to guests whatever the method (a GET on
 * one of these is part of a scan or grade, not a browse screen).
 */
const GUEST_GATED_PATHS: ReadonlyArray<[RegExp, SignupReason]> = [
  [/^\/v1\/scans(\/|$)/, "scan"],
  [/^\/v1\/livestream(\/|$)/, "scan"],
  [/^\/v1\/grade(\/|-jobs\/|$)/, "grade"],
  [/^\/v1\/inventory\/[^/]+\/grade-(photos|jobs|history)(\/|$)/, "grade"],
  [/^\/v1\/consents\/cardsight(\/|$)/, "cardsight"],
  [/^\/v1\/age-confirmation(\/|$)/, "cardsight"],
];

/**
 * Why a guest can't call this route, or null when they can. Browse reads (catalog, prices, slab
 * comps, their own empty MyDEX / Grading / Export lists, identity, status) stay open.
 */
export function guestRouteBlockReason(method: string, path: string): SignupReason | null {
  const m = method.toUpperCase();
  for (const [pattern, reason] of GUEST_GATED_PATHS) if (pattern.test(path)) return reason;
  if (m === "GET" || m === "HEAD") return null;
  if (GUEST_WRITES.has(`${m} ${path}`)) return null;
  return /^\/v1\/grading(\/|$)/.test(path) ? "grade" : "save";
}

export function guestRouteAllowed(method: string, path: string): boolean {
  return guestRouteBlockReason(method, path) === null;
}

/** One message for every guest wall (the reason only goes to logs). */
export function signupMessage(_reason?: SignupReason): string {
  return GUEST_SIGNUP_COPY.body;
}

/** Backend review: guest sessions last 24 hours and live in the session table. */
export const GUEST_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const GUEST_MINT_WINDOW_MS = 60 * 60 * 1000;
