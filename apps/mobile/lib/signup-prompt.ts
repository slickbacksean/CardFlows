import { router } from "expo-router";
import { useEffect } from "react";
import { isGuestSession, peekActiveUserId } from "./identity";

/**
 * Sean (Oct 18, 2026): free account required. Signed-out users are sent to sign in / sign up
 * (no "Not now" browse path). Kept as a safety net for gated actions if a session drops mid-flow.
 */
export function showSignupPrompt(): void {
  router.replace("/sign-up");
}

/** True when a non-guest session is active; otherwise send the user to sign-up. */
export function requireAccount(): boolean {
  if (peekActiveUserId() && !isGuestSession()) return true;
  showSignupPrompt();
  return false;
}

/** A screen that is itself a gated action (the camera): signed-out users go to sign-up. */
export function useAccountOrLeave(): void {
  useEffect(() => {
    if (requireAccount()) return;
  }, []);
}
