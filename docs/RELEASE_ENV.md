# Release env layout (P4)

Expo Go keeps working, and there are no new native modules. **Preview and production builds need one real value, `EXPO_PUBLIC_API_URL`.** Everything else is optional and stays off until Sean sets it.

## EAS profiles (`apps/mobile/eas.json`)
| Profile | Use | `APP_ENV` | EAS environment | Status today |
|---|---|---|---|---|
| `development` | Dev client, internal | `development` | `development` | Android works now. iOS needs the Apple account. |
| `preview` | Internal test build | `preview` | `preview` | **Android preview works now** (APK, internal distribution). iOS (ad hoc / TestFlight) is blocked until the Apple Developer account exists. |
| `production` | Store build | `production` | `production` | Android AAB works once the API URL is set. iOS is blocked on the Apple account. |

All three profiles extend `base` (Node 22.22.0 and the PostHog host). Preview and production also set `SENTRY_DISABLE_AUTO_UPLOAD=true`; see Sentry below. **No secret or per-environment value is committed.** Real values go in EAS environment variables:

```sh
eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://api.example.com --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_SENTRY_DSN --value <dsn> --visibility sensitive
eas env:create --environment production --name EXPO_PUBLIC_POSTHOG_KEY --value <key> --visibility sensitive
```

Repeat for `preview`, and for `development` if wanted. `apps/mobile/.env.example` lists the same keys for local runs (`.env.local` is gitignored).

> **`sensitive` only hides the value in EAS logs and the dashboard.** An `EXPO_PUBLIC_*` value is still inlined into the JS bundle, so anyone with the app can read it. Use `secret` visibility only for build-time values that never reach the bundle (for example, a future `SENTRY_AUTH_TOKEN`).

## Build-time checks (`apps/mobile/app.config.ts`)
- `APP_ENV` must be `development`, `preview` or `production`. Unset means development, and any other value fails the build.
- **Preview/production fail to build** if `EXPO_PUBLIC_API_URL` is missing, isn't an http(s) URL, or points at a loopback/LAN host (`localhost`, `127.x`, `10.x` including the emulator's `10.0.2.2`, `192.168.x`, `172.16–31.x`, `169.254.x`, `::1`, `*.local`). Only the API URL is required. Sentry and PostHog can stay unset.
- `EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TIMING` set in a production build fails the build.
- `extra.release` holds only booleans and key names (`apiUrlSet`, `crashReportingConfigured`, `analyticsConfigured`, `missingForRelease`, `optionalUnset`), never the values.

**Runtime backstop:** a build with `!__DEV__` and no usable API URL shows a "CardFlow can't connect" screen instead of the app. It never falls back to `127.0.0.1` or `10.0.2.2` (`releaseApiUrlProblem`, `resolveClientApiUrl` in `packages/shared/src/client-api-url.ts`). Dev builds keep using the local API.

## Every `EXPO_PUBLIC_*` variable
**All of them are public and in the bundle.** Metro inlines every `EXPO_PUBLIC_*` value into the JS that ships in the app, so none may hold a secret. The table matches `PUBLIC_ENV_VARS` in `app.config.ts`, and a test fails if the app reads one that isn't listed.

| Variable | What it does | Profiles that may set it | Unset means |
|---|---|---|---|
| `EXPO_PUBLIC_APP_ENV` | Profile name (set by eas.json) | all | development |
| `EXPO_PUBLIC_API_URL` | CardFlow API base URL | all (**required** in preview/production) | local dev API (dev only) |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry crash reports | all | crash reporting off |
| `EXPO_PUBLIC_POSTHOG_KEY` | PostHog project key | all | analytics off. Even when set, events also need the user's opt-in, which is off by default. |
| `EXPO_PUBLIC_POSTHOG_HOST` | PostHog host | all (default in `base`) | `https://us.i.posthog.com` |
| `EXPO_PUBLIC_CARD_FLOW_APP_KEY` | `X-CardFlow-App-Key` header for the API | all | header not sent. It's an abuse speed bump, not a secret; Sentry scrubs the header. |
| `EXPO_PUBLIC_HUDS_URL` | Livestream HUD helper URL (local tooling) | development, preview (guidance) | platform default |
| `EXPO_PUBLIC_CARD_FLOW_GRADE_JOBS` | Async pre-grade jobs (`=1`) | all | off |
| `EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TIMING` | Livestream timing logs (`=1`) | development, preview (**enforced**: a production build fails) | off |

## API env (staging and production)
- **`CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED` must stay unset** on the staging and production API until Sean makes the license decision (Ultralytics YOLO is AGPL-3.0). While it's unset, live-video YOLO is off and the weights are never loaded.
- `SENTRY_DSN` / `SENTRY_ENVIRONMENT` are set on Railway (see [SENTRY.md](./SENTRY.md)).

## OTA updates (EAS Update): out of scope for now
**EAS Update is out of scope for now.** Sean paused OTA updates until the Apple account exists. `expo-updates` isn't installed, and eas.json has no channels. To add it later:
1. `npx expo install expo-updates`. It ships in Expo Go and dev clients; store builds need a rebuild.
2. A `channel` per profile in eas.json (`development`, `preview`, `production`).
3. `runtimeVersion` in app config, either `{ "policy": "appVersion" }` (simple) or `{ "policy": "fingerprint" }` (safer for native changes).
4. `updates.url` (`https://u.expo.dev/<EAS project id>`), set by `eas update:configure`.
5. Decide who may run `eas update --channel production`, and roll back with `eas update:republish`.

## Sentry
- **Off without a DSN:** `initMobileSentry()` returns before `require("@sentry/react-native")`. It also returns when Settings > **Send crash reports** is off (on by default; turning it off closes the client right away).
- Dev builds never send (`enabled: !__DEV__`). Events carry `environment` (from `EXPO_PUBLIC_APP_ENV`), `release` (`app.cardflow.mobile@<version>`) and `dist` (build number).
- **Scrubbing:** `sendDefaultPii: false`; no screenshots, view hierarchy, replay, tracing or failed-request capture. `beforeSend` runs `scrubSentryEvent`, which drops:
  - request bodies, cookies, and the `Authorization` and `X-CardFlow-App-Key` headers;
  - emails, IP addresses, bearer tokens, and JWT-like or long base64 blobs, including ones embedded in longer strings;
  - token/code/password/key query values, local photo URIs, and any key ending in `token`, `secret`, `password` or `apiKey`/`api_key`.
- **Consent:** crash reports are **not** tied to the analytics opt-in (existing rule, PRIVACY_DATA_MAP §14). Sean may still choose opt-in instead; that's a one-line change (`CRASH_REPORTS_DEFAULT_ON` in `packages/shared/src/crash-reports.ts`) plus the privacy draft.
- **`SENTRY_DISABLE_AUTO_UPLOAD=true`** is set in the preview and production eas.json env, so EAS builds don't try to upload source maps without credentials and fail. Remove it once `SENTRY_AUTH_TOKEN` (plus `SENTRY_ORG` and `SENTRY_PROJECT`) is an EAS **secret**.

### Sentry dashboard (Sean, once per project: cardflow-api and cardflow-mobile)
1. Settings > Security & Privacy: turn **Prevent Storing of IP Addresses** on.
2. Settings > Security & Privacy: turn on the server-side **Data Scrubber** and **Use Default Scrubbers**. Add `email`, `password`, `token`, `secret`, `x-cardflow-app-key` as extra sensitive fields.
3. Don't log emails, request or response bodies, or API payloads with `console.*` in the API or the app. Sentry breadcrumbs pick them up.
4. Organization Settings > Legal & Compliance: accept Sentry's **Data Processing Addendum** (DPA), which includes the SCCs, and keep a copy for counsel.

## Account deletion (checked in P4)
- **API:** `POST /v1/account/delete` deletes, in one transaction, every `user_id` row, including the PokéCollector link (`crm_pokecollector_users`). It then deletes the user's photos and staged uploads, signs out every session, and queues what CardFlow stored on PokéCollector for deletion (below). The response never waits on PokéCollector.
  - North Star (H2): in the same transaction, the user's weekly counts (purchases, scans, active weeks) are added to `north_star_weekly_totals` (week, counts; no IDs), and their `purchase_events` rows are hard-deleted. `/ops/north-star` adds the totals to the live rows, so past weeks don't change. Older `deleted_<uuid>` ledger buckets are folded into the totals when the API starts.
  - PokéCollector (Backend re-review H1/M1): the remote user ID (only that: no CardFlow ID, email or username) goes into `pokecollector_pending_deletions` in the same transaction as the rows. A background queue (every minute, and after each orphan sweep) runs `DELETE /api/auth/users/{id}` with the admin token, the strongest option: PokéCollector deletes the user and every row it owns. A 404 counts as done only when the body is `{"detail": "User not found"}`. If the admin delete is refused and the process still has the link in memory, CardFlow signs in as the user, deletes every collection and wishlist item, then rotates the password (admin `PUT /api/auth/users/{id}` with `is_active: false`, else `PUT /api/auth/me/password`). After a restart only the admin delete is possible, so **the admin token must stay valid** (PokéCollector JWTs last 7 days). Failures retry with backoff (1 min, 5 min, 30 min, 2 h, 6 h, 12 h, then daily). Calls are paced at 30 requests and 2 logins a minute, under PokéCollector's per-IP 60 and 5. A remote user still linked to another CardFlow user, or a guest's shared user, is queued as `hold` and never deleted; the opaque-accounts relink freezes it. Keep PokéCollector accounts off until the opaque per-user accounts PR is merged (see that PR).
  - **Limit and alerts (Backend final review R3):** after 14 failed attempts (about 9 days with the backoff) a row becomes `failed` and the queue stops trying. That logs `[pokecollector-deletion] gave up on remote user <PokéCollector ID> …` (no CardFlow ID or email), counts `pokecollectorDeletionsFailed` in `/ops/metrics`, and sends a `pokecollector_deletion_failed` alert to Sentry or the webhook. `GET /ops/pokecollector-deletions` (ops token) returns counts only: `pending`, `held`, `failed`, `stuck` (pending for over 3 days) and `oldestPendingAt`. To fix a failed row: repair PokéCollector or the admin token, then `UPDATE pokecollector_pending_deletions SET mode = 'delete', attempts = 0, next_attempt_at = '<now>' WHERE mode = 'failed';`, or delete the user in PokéCollector by hand and remove the row.
  - **Pacing is per process:** the 30 requests and 2 logins a minute are counted inside one API process. Two API processes, or the API plus the relink script, share PokéCollector's per-IP limit (60 and 5) without coordinating. Run one API process against PokéCollector and don't run the relink while the deletion queue is busy.
  - Ops check: `SELECT mode, attempts, last_result, next_attempt_at FROM pokecollector_pending_deletions;` (no personal data).
  - `email_send_counts` keys are HMAC-SHA256 with `CARD_FLOW_SERVER_PEPPER` (required in production, 32+ random characters; the API refuses to start without it).
  - Accounts with a password must send it; guests and invite testers don't.
  - A retried delete with the same token gets `410`.
  - In-flight scans and grade jobs are refused afterwards. An orphan sweep (every 6 h) looks at every `user_id` in any table and removes rows of deleted accounts, and orphan image files older than an hour (on disk and in memory-image mode).
  - Each delete writes one audit row `{at, kind, rowsDeleted}` with no PII.
- **App:** Settings > **Delete account** lists what is deleted (including the PokéCollector line), the subscription and grading-credit notes, and the anonymous-totals line. It asks for the password, or for DELETE typed by guests and testers, then confirms once more.
  - Grade history keys on the phone are found from an on-device list of item IDs the phone has seen (`cardflow-item-index.json`, IDs only), plus the server's list when it still answers, so a failed list can't leave history behind.
  - It deletes on the server first. Only after that succeeds (or the server answers `410`/`401`) does it wipe the phone: write queue, scan queue and its photos, grade-flow photo files, grade flow state, on-phone grade history, query cache, analytics install ID and session.
  - If a step fails, the screen says so and suggests reinstalling.
- **Not covered:** photos CardSight already received (if the user allowed CardSight) are governed by CardSight's terms. PokéCollector's own pre-upgrade SQL dumps (`/app/backups`, `PRE_UPGRADE_BACKUP_KEEP`) keep deleted cards until they rotate out; set the keep count so that fits the backup window in the privacy policy.

## App Store Connect (once the Apple account exists)
- **Age rating:** the **18+** rating is set in App Store Connect (App Information > Age Rating, override to the higher rating after answering the questionnaire truthfully). It isn't a build setting. See APP_REVIEW_NOTES.md.
- Privacy labels: see STORE_PRIVACY_LABELS.md (includes Diagnostics > Crash Data).

## Sign in with Apple
A stub. See [SIGN_IN_WITH_APPLE.md](./SIGN_IN_WITH_APPLE.md).
