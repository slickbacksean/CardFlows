/**
 * P4: Sign in with Apple is a documented stub. It needs the Apple Developer account (the
 * "Sign in with Apple" capability on the App ID, a Services ID and a key for the API to verify
 * identity tokens), so nothing calls Apple yet and no button is shown. See
 * docs/SIGN_IN_WITH_APPLE.md for the plan.
 *
 * App Review 4.8: PokeSniper signs in with email and password only (no Google/Facebook login), so
 * Sign in with Apple is not required to ship. If a third-party login is ever added, this has to
 * ship with it.
 */
export const SIGN_IN_WITH_APPLE = {
  enabled: false,
  blockedOn: "Apple Developer account",
  /** The API route it will use once built. Not registered today (404). */
  plannedRoute: "/v1/sessions/apple",
} as const;

export function signInWithAppleAvailable(input: { platform: string }): boolean {
  return SIGN_IN_WITH_APPLE.enabled && input.platform === "ios";
}
