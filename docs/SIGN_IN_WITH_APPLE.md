# Sign in with Apple (P4)

**Status (Oct 19, 2026):** built behind flags (feat/signin-gate-terms). The app shows the Apple button on iOS only when the API reports Apple on (`GET /v1/auth/providers`), and the API accepts Apple tokens at `POST /v1/sessions/social` only when `CARD_FLOW_APPLE_SIGNIN=true` (audience `app.pokesniper.mobile`, nonce checked). Google sign-in shipped alongside it (App Review 4.8). Token revoke (step 3) is built: the app sends Apple's authorization code, the API exchanges it for a refresh token (AES-GCM sealed in `auth_identities.refresh_token_enc`) and revokes it via `https://appleid.apple.com/auth/revoke` when the account is deleted. Apple is only offered when the key is configured (`CARD_FLOW_APPLE_TEAM_ID`, `CARD_FLOW_APPLE_KEY_ID`, `CARD_FLOW_APPLE_PRIVATE_KEY`; see RELEASE_ENV.md). The app build needs `EXPO_PUBLIC_APPLE_SIGNIN_ENABLED=1` (adds the entitlement; new build). `SIGN_IN_WITH_APPLE.enabled` stays `false` as the default.

**Blocked on:** the Apple Developer account (Sean).

## Is it required to ship?
App Review Guideline 4.8 requires Sign in with Apple only when an app offers a third-party or social login (Google, Facebook, …). PokeSniper signs in with **email + password** only, so it is **not required** today. If a social login is ever added, Sign in with Apple must ship in the same release.

## What Sean needs to provide
1. Apple Developer Program membership.
2. The **Sign in with Apple** capability on the App ID `app.pokesniper.mobile`.
3. A **Services ID** and a **Sign in with Apple key** (`.p8`, Key ID, Team ID) for the API, so it can verify identity tokens.

## Plan once unblocked
1. App: `expo-apple-authentication` (included in Expo Go on iOS, so no new native module for testing; a store build needs the capability). Show the system button on iOS only, above email sign-in.
2. API: `POST /v1/sessions/apple` with `{ identityToken, nonce }`. Verify the JWT against Apple's JWKS (issuer `https://appleid.apple.com`, audience = bundle ID, nonce match), then find or create the account by Apple `sub`. The email may be a private relay address. The 18+ checkbox still applies at account creation.
3. Account deletion: when an Apple-linked account is deleted, also revoke the token with Apple's `/auth/revoke` (App Review 5.1.1(v)). Settings > Delete account already deletes everything on PokeSniper's side. **The token revoke must ship together with Sign in with Apple, in the same release, never after it.** Store the Apple refresh token encrypted, server-side only, and delete it in the same transaction as the other `user_id` rows.
4. Tests: token verification (bad issuer, audience, expired, nonce mismatch), first sign-in creates an account, a repeat sign-in finds it, and deletion revokes.
