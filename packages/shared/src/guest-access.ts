/**
 * D9 (Sean-approved): a guest gets **3 free scans**. Saving anything, or a 4th scan, needs
 * sign-up. The API enforces this; the app only shows the prompt.
 */
import type { InvitedIdentity } from "./identity";

export const GUEST_FREE_SCANS = 3;
export const GUEST_USER_PREFIX = "guest_";
export const SIGNUP_REQUIRED_CODE = "signup_required";

export type SignupReason = "scan_limit" | "save";

export const GUEST_SIGNUP_COPY = {
  title: "Sign up to keep going",
  scanLimit: "You've used your 3 free scans. Sign up free to keep scanning. Pre-grade estimates are counted separately.",
  save: "Sign up to save cards, track purchases and build listings.",
  action: "Sign up",
  dismiss: "Not now",
} as const;

export function isGuestUserId(userId: string | null | undefined): boolean {
  return typeof userId === "string" && userId.startsWith(GUEST_USER_PREFIX);
}

export function guestIdentity(userId: string): InvitedIdentity {
  return { userId, label: "Guest" };
}

export function guestScansRemaining(scansUsed: number): number {
  return Math.max(0, GUEST_FREE_SCANS - scansUsed);
}

/**
 * What a guest may call. Reads are fine (they only see their own scans); the only write is
 * creating a scan (count-limited separately) and perf telemetry. Everything else is a save step.
 */
export function guestRouteAllowed(method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return true;
  if (m === "POST" && (path === "/v1/scans" || path === "/v1/telemetry/perf")) return true;
  // The CardSight consent answer is asked before the first scan, so guests can give it too.
  if (m === "POST" && path === "/v1/consents/cardsight") return true;
  // Sean: 18+ only. The age gate comes before the first upload, so guests confirm it too.
  if (m === "POST" && path === "/v1/age-confirmation") return true;
  // A guest can delete their own guest data (used when the age gate says under 18).
  if (m === "POST" && path === "/v1/account/delete") return true;
  return false;
}

export function signupMessage(reason: SignupReason): string {
  return reason === "scan_limit" ? GUEST_SIGNUP_COPY.scanLimit : GUEST_SIGNUP_COPY.save;
}

/** Backend review: guest sessions last 24 hours and live in the session table. */
export const GUEST_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const GUEST_MINT_WINDOW_MS = 60 * 60 * 1000;

/** Shown before the first guest scan and on the save prompt (Policy). */
export const GUEST_RETENTION_NOTE =
  "Guest scans and photos are deleted within 24 hours after your guest session ends, unless you sign up. Signing up keeps them.";

/** The guest wall counts scans; pre-grade estimates are a separate monthly allowance. */
export const GUEST_SCAN_WALL_NOTE = "Guests get 3 free card scans. Pre-grade estimates have their own monthly allowance once you sign up.";
