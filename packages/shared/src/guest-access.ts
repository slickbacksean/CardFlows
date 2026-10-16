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
  scanLimit: `You've used your ${GUEST_FREE_SCANS} free scans. Sign up to keep scanning.`,
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
  return false;
}

export function signupMessage(reason: SignupReason): string {
  return reason === "scan_limit" ? GUEST_SIGNUP_COPY.scanLimit : GUEST_SIGNUP_COPY.save;
}
