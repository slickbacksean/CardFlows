# Sentry crash reporting (P0-12)

Sean approved Sentry for crash and error reporting. Nothing is sent until the DSNs below are set. Unset DSNs are a no-op: the API and the Expo app run as they do today, including **Expo Go**.

Session replay is off. Photos, image bytes, and emails are stripped before an event is sent.

## Create the Sentry projects

1. Sign in at [sentry.io](https://sentry.io) (free or team tier).
2. Create **two** projects in the CardFlow org:
   - **cardflow-api** — platform **Node.js / Express** (or generic Node).
   - **cardflow-mobile** — platform **React Native**.
3. Open each project → **Settings → Client Keys (DSN)** and copy the DSN.

Do not reuse one DSN for both. Request IDs (`x-request-id`) are tagged as `request_id` on API events so a phone report can be matched to a server error.

## Where to put the DSNs

| Variable | App | Where Sean sets it | Public? |
|---|---|---|---|
| `SENTRY_DSN` | API | Railway **staging** and **prod** service variables. Locally, gitignored `apps/api/.env` (see `apps/api/.env.example`). | No. Server-only. |
| `SENTRY_ENVIRONMENT` | API | Optional. `staging` or `production` next to `SENTRY_DSN`. | No. |
| `EXPO_PUBLIC_SENTRY_DSN` | Expo app | Gitignored `apps/mobile/.env` for Expo Go / simulators. EAS **preview** and **production** env for store builds. | The DSN is in the app binary by design. It is not a secret, but it is not a write credential. |

Restart the API after changing `SENTRY_DSN`. Restart Metro after changing `EXPO_PUBLIC_SENTRY_DSN`.

### Optional, EAS native source maps only

The Expo config plugin `@sentry/react-native` is listed in `apps/mobile/app.json`. Expo Go ignores plugins. For a later EAS native build that uploads source maps, set on the EAS project (not in git):

- `SENTRY_ORG`
- `SENTRY_PROJECT` (the **mobile** project slug)
- `SENTRY_AUTH_TOKEN` (a Sentry auth token with `project:releases`)

Crash reporting itself does **not** need those three. JS init only needs `EXPO_PUBLIC_SENTRY_DSN`.

## What is not sent

The shared scrubber (`packages/shared/src/sentry-scrub.ts`) drops:

- Emails (user.email, strings that look like emails)
- Request bodies, cookies, and `Authorization` headers
- Keys such as `photo`, `image`, `cropBytes`, `frontBytes`, `identityCropJpeg`, `base64`
- Data-URL / long base64 payloads (card photos)
- Local photo paths (`file://`, `content://`, `ph://`, `assets-library://` ending in .jpg/.png/.heic/.webp), added in P4
- Bearer tokens, and the values of `token`, `access_token`, `refresh_token`, `code`, `password`, `key`, `api_key` and `dsn` query parameters (P4)
- Keys named like `token`, `password` or `ip_address`, and any key ending in `token`, `secret`, `password` or `apiKey`/`api_key` (camelCase or snake_case) (P4)
- The `X-CardFlow-App-Key` header, and JWT-like or long base64 blobs even inside a longer string (P4 Dev Ops review)

Also disabled: session replay, screenshots, view hierarchy, failed-request bodies, default PII.

## Consent

Crash reporting is **not** tied to the in-app analytics opt-in. It has its own switch, Settings > **Send crash reports** (on by default, P4 Policy review): off means `initMobileSentry()` doesn't start Sentry, and turning it off later closes the client and drops anything queued. Sean may still choose opt-in instead (`CRASH_REPORTS_DEFAULT_ON`). Analytics consent covers PostHog product events only. Crash data is a separate, disclosed category (Crash Data, PRIVACY_DATA_MAP §14) and carries no PII or photos. P4 checked this and kept it. If it should require the opt-in too, gate `initMobileSentry()` on the stored analytics preference.

EAS profiles and the rest of the env layout: [RELEASE_ENV.md](./RELEASE_ENV.md).

## Expo Go

`initMobileSentry()` runs only when `EXPO_PUBLIC_SENTRY_DSN` is set and Send crash reports is on. Dev builds never send (`enabled: !__DEV__`). In Expo Go the native SDK is off (`enableNative: false`). Native crash reports need a dev client or store build.

## Privacy labels (App Store / Play)

List **Crash Data** (stack traces, device model, OS version, app version, request id). Do **not** list photos, emails, or location as sent to Sentry. Match [PRIVACY_DATA_MAP.md](./PRIVACY_DATA_MAP.md) §14.

## How to confirm it works

1. Set `SENTRY_DSN` on a staging API. Restart.
2. Force a 500 (or temporarily `throw` in a handler). The event in the **API** project should include tag `request_id`.
3. Set `EXPO_PUBLIC_SENTRY_DSN`, reload the app, trigger the in-app error boundary. The event lands in the **mobile** project. Expo Go will only show JS errors, not native crashes.
