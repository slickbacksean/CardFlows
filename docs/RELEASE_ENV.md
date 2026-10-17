# Release env layout (P4)

Everything here is **inert until Sean sets real values**. Expo Go keeps working, and there are no new native modules.

## EAS profiles (`apps/mobile/eas.json`)
| Profile | Use | `APP_ENV` | EAS environment |
|---|---|---|---|
| `development` | Dev client, internal | `development` | `development` |
| `preview` | Internal test build (TestFlight / ad hoc once the Apple account exists) | `preview` | `preview` |
| `production` | Store build | `production` | `production` |

All three extend `base` (Node 22.22.0, PostHog host). **No secret or per-environment value is committed.** Real values go in EAS environment variables:

```sh
eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://api.example.com --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_SENTRY_DSN --value <dsn> --visibility sensitive
eas env:create --environment production --name EXPO_PUBLIC_POSTHOG_KEY --value <key> --visibility sensitive
```
Repeat for `preview` (and `development` if wanted). `apps/mobile/.env.example` lists the same keys for local runs (`.env.local` is gitignored).

## The placeholders
| Key | Unset means |
|---|---|
| `EXPO_PUBLIC_API_URL` | The app uses the local dev API (`127.0.0.1:3001`, or `10.0.2.2` on the Android emulator). |
| `EXPO_PUBLIC_SENTRY_DSN` | Crash reporting is off. `@sentry/react-native` isn't even loaded. |
| `EXPO_PUBLIC_POSTHOG_KEY` | Analytics is off. Even when set, events also need the user's in-app opt-in (off by default). |
| `EXPO_PUBLIC_POSTHOG_HOST` | Defaults to `https://us.i.posthog.com` (from `base`). |

`apps/mobile/app.config.ts` reads `app.json`, then adds `extra.appEnv` and `extra.release`. These are booleans and key names only (`apiUrlSet`, `crashReportingConfigured`, `analyticsConfigured`, `missingForRelease`); no value is copied. A preview or production build with placeholders still builds; `missingForRelease` lists what's missing.

## Sentry (checked in P4)
- **Off without a DSN:** `initMobileSentry()` returns before `require("@sentry/react-native")`.
- **Scrubbing:** `sendDefaultPii: false`; no screenshots, view hierarchy, replay, tracing or failed-request capture. `beforeSend` runs `scrubSentryEvent`, which drops request bodies, cookies, auth headers, emails, IPs, image bytes and data URLs. Since P4 it also drops bearer tokens, token/code/password/key query parameters and local photo URIs (`file://…jpg`, etc.).
- **Consent:** the existing rule (docs/SENTRY.md, PRIVACY_DATA_MAP §14) does **not** tie crash reporting to the analytics opt-in. Analytics consent covers PostHog product events only, and crash reports are disclosed as Crash Data. P4 keeps that rule. If Sean wants crash reports to need the opt-in too, it's a small change to `initMobileSentry`.

## Account deletion (checked in P4)
- **API:** `POST /v1/account/delete` deletes every `user_id` row in one transaction, the user's photos and staged uploads, and every session. The purchase ledger is anonymized. Covered by `app.accounts.test.ts` and `account-deletion-e2e.test.ts`.
- **Gap fixed:** guests were refused (403 `signup_required`). They can now delete their guest data right away.
- **Gap fixed:** the app had no way to delete an account. Settings now has **Delete account**, which lists what is deleted, asks the user to type `DELETE`, then confirms once more. It deletes on the server first; only after that succeeds does it clear the phone's write queue, scan queue (and its photos), grade flow, query cache, analytics install ID and session.
- **Not covered:** photos CardSight already received (if the user allowed CardSight) are governed by CardSight's terms. The consent copy already says turning it off doesn't remove them.

## Sign in with Apple
A stub. See [SIGN_IN_WITH_APPLE.md](./SIGN_IN_WITH_APPLE.md).
