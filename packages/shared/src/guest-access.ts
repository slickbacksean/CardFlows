/**
 * Sean (Oct 18, 2026): guest look-around is removed. The app requires a free account before any
 * screen. Helpers below remain for (1) refusing leftover guest sessions on the API when
 * CARD_FLOW_GUEST_BROWSE is accidentally left on, and (2) cleaning old guest rows. The mobile
 * app never mints guest sessions.
 *
 * Earlier (Oct 17): guests were browse-only with 403 `signup_required` on scan/grade/save.
 */
import type { InvitedIdentity } from "./identity";

export const GUEST_USER_PREFIX = "guest_";
export const SIGNUP_REQUIRED_CODE = "signup_required";

/** What the guest tried (for logs and the app); every reason shows the same copy. */
export type SignupReason = "scan" | "grade" | "cardsight" | "save";

export const GUEST_SIGNUP_COPY = {
  title: "Create a free account",
  body: "Create a free account to use CardFlow.",
  action: "Sign up",
  dismiss: "Cancel",
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
