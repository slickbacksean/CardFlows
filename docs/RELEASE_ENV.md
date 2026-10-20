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

**Runtime backstop:** a build with `!__DEV__` and no usable API URL shows a "PokeSniper can't connect" screen instead of the app. It never falls back to `127.0.0.1` or `10.0.2.2` (`releaseApiUrlProblem`, `resolveClientApiUrl` in `packages/shared/src/client-api-url.ts`). Dev builds keep using the local API.

## Every `EXPO_PUBLIC_*` variable
**All of them are public and in the bundle.** Metro inlines every `EXPO_PUBLIC_*` value into the JS that ships in the app, so none may hold a secret. The table matches `PUBLIC_ENV_VARS` in `app.config.ts`, and a test fails if the app reads one that isn't listed.

| Variable | What it does | Profiles that may set it | Unset means |
|---|---|---|---|
| `EXPO_PUBLIC_APP_ENV` | Profile name (set by eas.json) | all | development |
| `EXPO_PUBLIC_API_URL` | PokeSniper API base URL | all (**required** in preview/production) | local dev API (dev only) |
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
- **Off without a DSN:** `initMobileSentry()` returns before `require("@sentry/react-native")`. It also returns when Settings > **Send crash reports** is off (off by default; opt-in; turning it off closes the client right away).
- Dev builds never send (`enabled: !__DEV__`). Events carry `environment` (from `EXPO_PUBLIC_APP_ENV`), `release` (`app.cardflow.mobile@<version>`) and `dist` (build number).
- **Scrubbing:** `sendDefaultPii: false`; no screenshots, view hierarchy, replay, tracing or failed-request capture. `beforeSend` runs `scrubSentryEvent`, which drops:
  - request bodies, cookies, and the `Authorization` and `X-CardFlow-App-Key` headers;
  - emails, IP addresses, bearer tokens, and JWT-like or long base64 blobs, including ones embedded in longer strings;
  - token/code/password/key query values, local photo URIs, and any key ending in `token`, `secret`, `password` or `apiKey`/`api_key`.
- **Consent:** crash reports are **not** tied to the analytics opt-in (existing rule, PRIVACY_DATA_MAP §14). They are **opt-in** (`CRASH_REPORTS_DEFAULT_ON = false` in `packages/shared/src/crash-reports.ts`); Sentry is not initialized until the user turns them on.
- **`SENTRY_DISABLE_AUTO_UPLOAD=true`** is set in the preview and production eas.json env, so EAS builds don't try to upload source maps without credentials and fail. Remove it once `SENTRY_AUTH_TOKEN` (plus `SENTRY_ORG` and `SENTRY_PROJECT`) is an EAS **secret**.

### Sentry dashboard (Sean, once per project: cardflow-api and cardflow-mobile)
1. Settings > Security & Privacy: turn **Prevent Storing of IP Addresses** on.
2. Settings > Security & Privacy: turn on the server-side **Data Scrubber** and **Use Default Scrubbers**. Add `email`, `password`, `token`, `secret`, `x-cardflow-app-key` as extra sensitive fields.
3. Don't log emails, request or response bodies, or API payloads with `console.*` in the API or the app. Sentry breadcrumbs pick them up.
4. Organization Settings > Legal & Compliance: accept Sentry's **Data Processing Addendum** (DPA), which includes the SCCs, and keep a copy for counsel.

## Account deletion (checked in P4)
- **API:** `POST /v1/account/delete` deletes, in one transaction, every `user_id` row, including the PokéCollector link (`crm_pokecollector_users`). It then deletes the user's photos and staged uploads, signs out every session, and queues what PokeSniper stored on PokéCollector for deletion (below). The response never waits on PokéCollector.
  - North Star (H2): in the same transaction, the user's weekly counts (purchases, scans, active weeks) are added to `north_star_weekly_totals` (week, counts; no IDs), and their `purchase_events` rows are hard-deleted. `/ops/north-star` adds the totals to the live rows, so past weeks don't change. Older `deleted_<uuid>` ledger buckets are folded into the totals when the API starts.
  - PokéCollector (Backend re-review H1/M1): the remote user ID (only that: no PokeSniper ID, email or username) goes into `pokecollector_pending_deletions` in the same transaction as the rows. A background queue (every minute, and after each orphan sweep) runs `DELETE /api/auth/users/{id}` with the admin token, the strongest option: PokéCollector deletes the user and every row it owns. A 404 counts as done only when the body is `{"detail": "User not found"}`. If the admin delete is refused and the process still has the link in memory, PokeSniper signs in as the user, deletes every collection and wishlist item, then rotates the password (admin `PUT /api/auth/users/{id}` with `is_active: false`, else `PUT /api/auth/me/password`). After a restart only the admin delete is possible, so **the admin token must stay valid** (PokéCollector JWTs last 7 days). Failures retry with backoff (1 min, 5 min, 30 min, 2 h, 6 h, 12 h, then daily). Calls are paced at 30 requests and 2 logins a minute, under PokéCollector's per-IP 60 and 5. A remote user still linked to another PokeSniper user, or a guest's shared user, is queued as `hold` and not deleted by the queue; the opaque-accounts relink then admin-deletes it if no live account links to it any more, or freezes it if one still does (final review R1). Keep PokéCollector accounts off until the opaque per-user accounts PR is merged (see that PR).
  - **Limit and alerts (Backend final review R3):** after 14 failed attempts (about 9 days with the backoff) a row becomes `failed` and the queue stops trying. That logs `[pokecollector-deletion] gave up on remote user <PokéCollector ID> …` (no PokeSniper ID or email), counts `pokecollectorDeletionsFailed` in `/ops/metrics`, and sends a `pokecollector_deletion_failed` alert to Sentry or the webhook. `GET /ops/pokecollector-deletions` (ops token) returns counts only: `pending`, `held`, `failed`, `stuck` (pending for over 3 days) and `oldestPendingAt`. To fix a failed row: repair PokéCollector or the admin token, then `UPDATE pokecollector_pending_deletions SET mode = 'delete', attempts = 0, next_attempt_at = '<now>' WHERE mode = 'failed';`, or delete the user in PokéCollector by hand and remove the row.
  - **Pacing is per process:** the 30 requests and 2 logins a minute are counted inside one API process. Two API processes, or the API plus the relink script, share PokéCollector's per-IP limit (60 and 5) without coordinating. Run one API process against PokéCollector and don't run the relink while the deletion queue is busy.
  - Ops check: `SELECT mode, attempts, last_result, next_attempt_at FROM pokecollector_pending_deletions;` (no personal data).
  - `email_send_counts` keys are HMAC-SHA256 with `CARD_FLOW_SERVER_PEPPER` (required in production, 32+ random characters; the API refuses to start without it).
  - Accounts with a password must send it; invite testers don't.
  - A retried delete with the same token gets `410`.
  - In-flight scans and grade jobs are refused afterwards. An orphan sweep (every 6 h) looks at every `user_id` in any table and removes rows of deleted accounts, and orphan image files older than an hour (on disk and in memory-image mode).
  - Each delete writes one audit row `{at, kind, rowsDeleted}` with no PII.
- **App:** Settings > **Delete account** lists what is deleted (including the PokéCollector line), the subscription and grading-credit notes, and the anonymous-totals line. It asks for the password, or for DELETE typed by invite testers, then confirms once more.
  - Grade history keys on the phone are found from an on-device list of item IDs the phone has seen (`cardflow-item-index.json`, IDs only), plus the server's list when it still answers, so a failed list can't leave history behind.
  - It deletes on the server first. Only after that succeeds (or the server answers `410`/`401`) does it wipe the phone: write queue, scan queue and its photos, grade-flow photo files, grade flow state, on-phone grade history, query cache, analytics install ID and session.
  - If a step fails, the screen says so and suggests reinstalling.
- **Not covered:** photos CardSight already received (if the user allowed CardSight) are governed by CardSight's terms. PokéCollector's own pre-upgrade SQL dumps (`/app/backups`, `PRE_UPGRADE_BACKUP_KEEP`) keep deleted cards until they rotate out; set the keep count so deleted cards rotate out within the 90-day backup window in the privacy policy.

## App Store Connect (once the Apple account exists)
- **Age rating:** the **18+** rating is set in App Store Connect (App Information > Age Rating, override to the higher rating after answering the questionnaire truthfully). It isn't a build setting. See APP_REVIEW_NOTES.md.
- Privacy labels: see STORE_PRIVACY_LABELS.md (includes Diagnostics > Crash Data).

## Sign in with Apple
A stub. See [SIGN_IN_WITH_APPLE.md](./SIGN_IN_WITH_APPLE.md).

## PokéCollector accounts: keep them OFF in staging and production

Accounts are **off unless `CARD_FLOW_POKECOLLECTOR_ACCOUNTS=true`** (Backend re-review M3).
Leave it unset in staging and production (catalog and pricing keep working) until **both** of
these are true:

1. PR 96 and then the "PokéCollector: opaque per-user accounts" PR are merged and deployed.
2. The relink script has been run against that environment, dry run first:
   ```sh
   pnpm --filter @cardflow/api pokecollector:relink                      # dry run: no network call, no DB write
   pnpm --filter @cardflow/api pokecollector:relink -- --apply --confirm-url="$CARD_FLOW_POKECOLLECTOR_URL"
   ```
   It gives every PokeSniper user with a legacy (email-derived or shared) link, or with PokeSniper
   inventory and no link, a fresh opaque PokéCollector user rebuilt from PokeSniper's own
   inventory, drops guest links, freezes each old remote user (random password,
   `is_active: false`) once nothing points at it, and ends by freezing every remote `cardflow-*`
   user that isn't opaque and isn't linked (admin `GET /api/auth/users`). Review the dry-run plan
   with Sean before `--apply`.
   - **Delete vs freeze (Backend final review R1):** a `hold` row in
     `pokecollector_pending_deletions` whose remote user no live PokeSniper account links to (every
     owner deleted their account) is **admin-DELETEd** (`DELETE /api/auth/users/{id}`), so the
     account-deletion copy stays true. Only remote users still shared with a live account are
     frozen, after each live account on them has its own opaque user. A failed delete is never
     turned into a freeze: the hold row stays and a rerun tries again (`deleteFailed` in the
     output). Strays (no link, owner unknown) are frozen, not deleted. The plan's `action` field
     says which; the summary counts `plan.delete` and `plan.freeze`.
   - **Output (re-review L3):** stdout shows counts and hashed IDs only. The full plan goes to
     `--plan-file` (default `./pokecollector-relink-plan.json`, mode 0600).
   - **Crash-safe (re-review H2):** `--state-file` (default `./pokecollector-relink-state.json`,
     mode 0600) gets the freeze list before any write, then copy progress per user. If a run
     stops, run the same command again with the same state file: it reuses pending rows and
     their passwords and resumes copies where they stopped (a crash right after a remote write can
     leave one duplicate card). Delete both files when the relink is done.
   - **Resume caveat:** copy progress is saved as a count into each user's inventory order, not
     per item. If a user's PokeSniper inventory changes between a crash and the rerun (a purchase,
     a removal, a closed watchlist item), the resume can skip or repeat items for that user. Rerun
     soon after a crash, keep the API's PokéCollector accounts off while the relink runs (they are
     off until step 3 anyway), and spot-check any user whose inventory changed.
   - Paced at 30 requests and 2 logins a minute (PokéCollector allows 60 and 5 per IP), so a big
     relink takes a while: about 1 request per copy plus 1 login and 1 create per user.
   - **Pacing is per process:** the script, each API process and the API's deletion queue each
     have their own 30/2 budget and don't coordinate. Together they can pass PokéCollector's
     per-IP 60 and 5. Run the relink while one API process at most talks to PokéCollector and the
     deletion queue is idle (`GET /ops/pokecollector-deletions` shows `pending: 0`).

Why: before this PR, PokéCollector usernames came from the email local part, so
`sean@gmail.com` and `sean@yahoo.com` (or `sean.h@…` and `sean_h@…`) landed on one remote user
and saw each other's cards, and every guest shared `cardflow-guest`.

Required to turn accounts on (fail closed, no fallback values):

| Variable | What |
| --- | --- |
| `CARD_FLOW_POKECOLLECTOR_ACCOUNTS` | `true` to turn accounts on. Anything else is off. |
| `CARD_FLOW_POKECOLLECTOR_URL` | PokéCollector backend (loopback or private network only). |
| `CARD_FLOW_POKECOLLECTOR_TOKEN` | Admin JWT; used only to create, freeze and delete users. **Expires after 7 days** (PokéCollector `ACCESS_TOKEN_EXPIRE_MINUTES`). Either refresh it by hand (sign in as the admin, copy the new `access_token`, redeploy) or set the two variables below instead. |
| `CARD_FLOW_POKECOLLECTOR_ADMIN_USERNAME` / `CARD_FLOW_POKECOLLECTOR_ADMIN_PASSWORD` | Optional (re-review M2). PokeSniper mints its admin token at first use and again on a 401, so the token can't silently expire. Treat as the PokéCollector admin password. |
| `CARD_FLOW_POKECOLLECTOR_USER_PEPPER` | 32+ random chars. HMAC key for usernames `cardflow-u-<base32(HMAC-SHA256(userId))[:20]>`. Never change it. |
| `CARD_FLOW_POKECOLLECTOR_LINK_KEY` | 32-byte AES-256-GCM key (base64 or hex). Encrypts each link's random password at rest (`v2:<key id>:…`). Back it up with the database; losing it loses every link. |
| `CARD_FLOW_POKECOLLECTOR_PREVIOUS_LINK_KEYS` | Optional, comma-separated (re-review L2). To rotate: put the old key here, a new one in `LINK_KEY`, deploy, then run the re-encrypt below. Old links still decrypt (by key ID). **An old key must stay here until the re-encrypt has run** (final review R4): removing it earlier makes every link still under it unreadable. |

### Rotating the link key (final review R4)

1. Put the new key in `CARD_FLOW_POKECOLLECTOR_LINK_KEY` and add the old one to
   `CARD_FLOW_POKECOLLECTOR_PREVIOUS_LINK_KEYS`. Deploy.
2. Re-encrypt every link under the new key (local database only, never calls PokéCollector;
   stdout shows counts and hashed IDs only):
   ```sh
   pnpm --filter @cardflow/api pokecollector:reencrypt-links              # dry run (default): counts, no write
   pnpm --filter @cardflow/api pokecollector:reencrypt-links -- --apply   # calls reencryptLinkPassword for each link
   ```
3. Run the dry run again. Only when it shows `needsRotation: 0` and `failed: []` remove the old key
   from `PREVIOUS_LINK_KEYS` and deploy. A `failed` row is a link no configured key can read; that
   user has to be relinked.

A user's PokéCollector token that expires (401) is dropped and the user signs in again once
(re-review M2). User tokens are cached in memory, so a restart costs one login per active user,
paced by PokéCollector's 5 logins a minute.

The PokéCollector container must run with `USER_MODE=multi` (set in
`infra/pokecollector/docker-compose.yml`): in single-user mode PokéCollector treats a request
with no token as the admin.

### Merge order and the pre-merge checklist (Backend final review)

Merge procedure (merge commits only, no squash or rebase):

1. Merge PR 96 into `main` with a merge commit.
2. Retarget this PR's base to `main` by hand (GitHub may not do it) and confirm it shows
   **0 commits behind** `main`. If it's behind, merge `main` into this branch and wait for CI.
3. Merge this PR with a merge commit.
4. Deploy both together (one deploy). Leave `CARD_FLOW_POKECOLLECTOR_ACCOUNTS` unset.

Before merging, and again before deploying, on each staging and production database:

- **Migrations:** check what the database has already applied:
  ```sql
  SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 5;
  ```
  The newest `created_at` must be **at most `1791350400000`** (0020, the last migration on
  `main`). The two PRs add 0021 `1791436800000`, 0022 `1791523200000`, 0023 `1791566400000` (PR 96)
  and 0024 `1791609600000` (this PR); the migrator skips any whose `when` is older than the newest
  applied one. If a row is newer than `1791350400000`, a renumbered or unmerged migration was
  applied: stop and fix it by hand first.
- **Env:** `CARD_FLOW_SERVER_PEPPER` (required in production, 32+ random characters),
  `CARD_FLOW_OPS_TOKEN` (for `/ops/*`, including `/ops/pokecollector-deletions`), and
  `CARD_FLOW_POKECOLLECTOR_ACCOUNTS` **unset**. Before accounts go on: `CARD_FLOW_POKECOLLECTOR_URL`,
  `CARD_FLOW_POKECOLLECTOR_TOKEN` or `CARD_FLOW_POKECOLLECTOR_ADMIN_USERNAME`/`_PASSWORD`,
  `CARD_FLOW_POKECOLLECTOR_USER_PEPPER`, `CARD_FLOW_POKECOLLECTOR_LINK_KEY` (backed up with the
  database), optional `CARD_FLOW_POKECOLLECTOR_PREVIOUS_LINK_KEYS`, and PokéCollector's
  `USER_MODE=multi`.
- **Relink (after the deploy, with Sean's go-ahead):** set the PokéCollector secrets above but keep
  `CARD_FLOW_POKECOLLECTOR_ACCOUNTS` unset; run the relink dry run and review the plan file
  (`plan.delete`, `plan.freeze`, `plan.relink`) with Sean; run `--apply --confirm-url=…` with a
  state file; rerun with the same state file until `relinkFailed`, `copiesFailed`, `freezeFailed`
  and `deleteFailed` are empty and `strayCheckFailed` is false; check
  `GET /ops/pokecollector-deletions` shows `held: 0`; delete the plan and state files; then set
  `CARD_FLOW_POKECOLLECTOR_ACCOUNTS=true` and deploy.

### Unknowns to validate on a staging PokéCollector before turning accounts on

Read from the pinned `ghcr.io/git-romer/pokecollector-backend:1.51.0` source (unchanged in
1.51.2); confirm each one against a running server:

- **Duplicate `POST /api/auth/users`:** the source answers `400 {"detail": "Username already exists"}`.
  PokeSniper treats 400/409 as "maybe ours" and binds only if this link's own password signs in.
  Confirm the status and that no other status is used.
- **Rate limits:** 60 requests/minute per client IP for every route (slowapi), and **5 logins per
  minute per IP** on `/api/auth/login`. PokeSniper calls from one IP, so at most 5 user sign-ins a
  minute across all users (tokens are cached in memory per user, lost on restart). JWTs last 7
  days in the source. Background work (deletion queue, relink) is paced at 30 requests and 2
  logins a minute. Check whether `X-Forwarded-For` changes the key and that the limits match.
- **Retention:** `DELETE /api/auth/users/{id}` deletes the user's rows, but PokéCollector keeps
  automatic pre-upgrade SQL dumps in `/app/backups` (newest `PRE_UPGRADE_BACKUP_KEEP`, default
  10) and manual backups. Those keep frozen and deleted users' cards until they rotate out;
  size `PRE_UPGRADE_BACKUP_KEEP` so that fits the 90-day backup window in the privacy policy.
- **`GET /api/collection/user/{user_id}` exposes other users:** yes, in the source any signed-in
  user can read any active user's (non-custom) collection by numeric ID. PokeSniper never calls it
  and never gives users a PokéCollector token, but a leaked per-user token could enumerate others.
  Freezing (`is_active: false`) hides an old user from it.
- Also confirm: the login response carries `user.id` (PokeSniper checks it matches the link), admin
  `PUT /api/auth/users/{id}` accepts `{password, is_active}` for freezing, admin
  `GET /api/auth/users` returns `[{id, username, role, is_active}]`, and admin
  `DELETE /api/auth/users/{id}` answers `404 {"detail": "User not found"}` for a missing user.
