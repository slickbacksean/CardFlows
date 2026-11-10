# Release env layout (P4)

Expo Go keeps working (`npx expo start`; Expo Go already includes `expo-updates` and ignores this project's EAS channels). **Preview and production builds need one real value, `EXPO_PUBLIC_API_URL`.** Everything else is optional and stays off until Sean sets it. A TestFlight/dev-client iOS binary must **rebuild** once so it contains `expo-updates`.

## EAS profiles (`apps/mobile/eas.json`)
| Profile | Use | `APP_ENV` | EAS environment | Status today |
|---|---|---|---|---|
| `development` | Dev client, internal | `development` | `development` | Android works now. iOS needs the Apple account. EAS Update channel `development`. |
| `preview` | Internal test build | `preview` | `preview` | **Android preview works now** (APK, internal distribution). iOS (ad hoc / TestFlight) is blocked until the Apple Developer account exists. EAS Update channel `preview`. |
| `production` | Store build | `production` | `production` | Android AAB works once the API URL is set. iOS is blocked on the Apple account. EAS Update channel `production`. |

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
| `EXPO_PUBLIC_API_URL` | PokeSniper API base URL | all (**required** in preview/production) | local dev API (dev only); preview/production builds fail |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry crash reports | all | crash reporting off |
| `EXPO_PUBLIC_SENTRY_ENVIRONMENT` | Sentry `environment` override | all | `EXPO_PUBLIC_APP_ENV` |
| `EXPO_PUBLIC_CARD_FLOW_IAP_ENABLED` | In-app purchases (`true`/`1`); off hides every price | all | off: no prices, "Subscriptions are opening soon." |
| `EXPO_PUBLIC_POSTHOG_KEY` | PostHog project key | all | analytics off. Even when set, events also need the user's opt-in, which is off by default. |
| `EXPO_PUBLIC_POSTHOG_HOST` | PostHog host | all (default in `base`) | `https://us.i.posthog.com` |
| `EXPO_PUBLIC_CARD_FLOW_APP_KEY` | `X-CardFlow-App-Key` header for the API | all | header not sent. It's an abuse speed bump, not a secret; Sentry scrubs the header. |
| `EXPO_PUBLIC_HUDS_URL` | Livestream HUD helper URL (local tooling) | development, preview (guidance) | platform default |
| `EXPO_PUBLIC_CARD_FLOW_GRADE_JOBS` | Async pre-grade jobs (`=1`) | all | off |
| `EXPO_PUBLIC_APPLE_SIGNIN_ENABLED` | `=1` adds the Sign in with Apple entitlement/plugin and shows the button (needs a new build) | all | Apple button hidden, no entitlement |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google sign-in, iOS OAuth client ID (public) | all | Google button hidden on iOS |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | Google sign-in, Android OAuth client ID (public) | all | Google button hidden on Android |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google sign-in, web OAuth client ID (public) | all | Google button hidden on web |
| `EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TIMING` | Livestream timing logs (`=1`) | development, preview (**enforced**: a production build fails) | off |
| `EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TEMPORAL_VOTING` | Multi-frame temporal voting: averages per-frame similarities + best frame's score across hold (`=1`). Research shows +4.5pp on streams, +10pp on eBay. | all | off |
| `EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_PRICE_SNAPSHOT` | Bulk livestream price snapshot (`=1`) | development, preview (**enforced**: production fails). Default **off** — TCGplayer on-device cache is under Policy review. | off |
| `EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TCGPLAYER_LINK` | HUD link-out “See prices on TCGplayer” (`=1`) | all | off |

## API env (staging and production)
- **`CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED` must stay unset** on the staging and production API until Sean makes the license decision (Ultralytics YOLO is AGPL-3.0). While it's unset, live-video YOLO is off and the weights are never loaded.
- `SENTRY_DSN` / `SENTRY_ENVIRONMENT` are set on Railway (see [SENTRY.md](./SENTRY.md)).
- **Migration `0034_process_state`:** additive. No new env vars. On deploy the entrypoint applies it under `flock` (grade jobs, abuse rate-limit buckets, deletion receipts, 24 h recognition cache). Grade-job request bodies land at `/data/grade/jobs/`. Left in memory on purpose: 15 min price cache, `/v1/status` banner (~30 s), OBB/OCR/YOLO engines, ops-metrics samples, PokéCollector JWT cache and pacer, PokéCollector delete-as-user fallback mappings (the queue rows are already in SQLite), grade upload staging (15 min), in-flight pregrade coalescing, scan/write idempotency in-flight registry (completed work is in SQLite), admin token-bucket limits (minutes-long windows).

## API URL per profile (Dev Ops, blocking)
There is **no hardcoded default**. Set `EXPO_PUBLIC_API_URL` as an EAS environment variable on each environment, so a profile that extends production can't silently point at prod:
```
eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://api.pokesniper.app --visibility plaintext
eas env:create --environment preview --name EXPO_PUBLIC_API_URL --value <staging API URL> --visibility plaintext
```
A new profile must set its own `environment` and its own variable. Missing or loopback/LAN → `app.config.ts` fails the build; a release bundle that slips through shows the config error screen, never localhost.

## Live Scan kill switch
- API env `CARD_FLOW_LIVESTREAM_ENABLED` on Railway (default on). Set `false` to turn Live Scan off; Railway **redeploys** the service to apply it.
- Apps pick it up on the next `/v1/status` poll (every `STATUS_POLL_MS`) or immediately on the next livestream call (503 `feature_disabled`). No app update needed.
- These 503s carry `x-cardflow-feature-disabled` and are excluded from 5xx error-spike alerts and mobile Sentry.

## Trending tab (replaces Grade in the tab bar)
Grade stays in the codebase (`/v1/grade/*`, `/v1/grading`, `grading.tsx`) but is hidden from the tab bar. Trending is off until Sean turns it on.

| Variable | Default | What it does |
|---|---|---|
| `CARD_FLOW_TRENDING_ENABLED` | **off** | API `GET /v1/trending` + `features.trending` on `GET /v1/status`. Apps show the Trending tab only when this is `1` / `true` / `on` / `yes`. Redeploy/restart the API to apply it. |
| `CARD_FLOW_TRENDING_SNAPSHOT_ENABLED` | off, unless Trending is on | In-process daily price snapshot. Default source is TCGCSV. Turn this on **about 8 days before** the tab so 7-day movers have history. |
| `CARD_FLOW_TRENDING_SNAPSHOT_INTERVAL_MS` | `86400000` (24h) | How often the API process re-runs the snapshot. Skips if a successful run already finished today (or within 20h). |
| `CARD_FLOW_TRENDING_PRICE_SOURCE` | `tcgcsv` | `tcgcsv` (free daily TCGplayer dumps, no API key) or `pokemontcg` (legacy api.pokemontcg.io fallback). |
| `CARD_FLOW_TCGCSV_USER_AGENT` | `PokeSniper/1.0 (trending-snapshot)` | User-Agent sent to tcgcsv.com. Their docs block generic/missing agents. |
| `CARD_FLOW_TCGCSV_REQUEST_DELAY_MS` | `150` | Delay between TCGCSV requests (their docs ask for ≥100ms). |
| `POKEMONTCG_API_KEY` | unset | Only used when `CARD_FLOW_TRENDING_PRICE_SOURCE=pokemontcg`. Optional `X-Api-Key` for api.pokemontcg.io. Server-only; never put this on the phone or in logs. |

**Job schedule**
- In-process: on API boot (if the snapshot flag is on) then every 24h, with a 20h minimum gap so a restart does not double-fetch.
- External cron (recommended on Railway): `0 6 * * *` UTC → `POST /ops/trending/snapshot` with `Authorization: Bearer $CARD_FLOW_OPS_TOKEN`. Add `?force=1` to re-run the same UTC day even if last-updated.txt has not changed.
- TCGCSV path: `GET last-updated.txt`, then Pokemon `categoryId=3` groups, then each group's `products` + `prices`. Skips the pull when last-updated.txt matches the last successful dump. Groups are processed one at a time (small Railway memory). A failed group is skipped; other groups still write. Idempotent upserts per UTC day.
- Snapshots older than 90 days are deleted.
- Unmatched products (unknown set, sealed, non-English) are stored in `pokemon_tcg_id_map` (`mapping_status=unmatched`, TCGCSV keys look like `tcgcsv:{productId}`) and omitted from the tab. See [CARD_ID_MAPPING_PLAN.md](./CARD_ID_MAPPING_PLAN.md) § TCGCSV.
- Migration `0035_trending_prices` (after `0034_process_state`): mapping table, daily snapshots, run log. No new migration for the TCGCSV switch.

The client has **no** `EXPO_PUBLIC_CARD_FLOW_TRENDING_*` variable — same pattern as grading: `useTrendingEnabled()` reads `/v1/status`.

## Live identity sidecar (DINOv2 fusion ship config)

The `live-identity-openclip` sidecar prefers **three-model fusion** when the H/D/E vars are complete, then the **legacy single** `TRAINED_MODEL_*` path, then OpenCLIP. Model weights, catalogs, `fam.json`, and `hr_cat/` are **not in git** — upload the ship `bundle/` to the Railway volume and keep its relative paths. See [RAILWAY_VOLUME_SETUP.md](./RAILWAY_VOLUME_SETUP.md).

Loading order:
1. `TRAINED_MODEL_FUSION` set **and** all H/D/E weight + catalog paths + `TRAINED_MODEL_CAT_IDS` exist → `r18h×2 + d + e` fusion (refuse start if catalog IDs ≠ 20339 or npy shape mismatches; do not fuse 2/3 models if one checkpoint is corrupt).
2. Else if legacy `TRAINED_MODEL_WEIGHTS` / `_CAT_FULL` / `_CAT_ART` / `_CAT_IDS` are complete → single DINOv2 (accept **0.68**, margin **0.02**, unchanged).
3. Else → OpenCLIP HNSW (`LIVE_IDENTITY_*`).

`TRAINED_MODEL_FUSION=1` with only `TRAINED_MODEL_WEIGHTS` is **not** fusion.

### Fusion (ship)

| Variable | Meaning | Ship value |
|---|---|---|
| `TRAINED_MODEL_FUSION` | Enable multi-model fusion | `1` or `r18h2de` |
| `TRAINED_MODEL_H_WEIGHTS` | r18h checkpoint | `bundle/models/r18h/b1_best.pt` |
| `TRAINED_MODEL_D_WEIGHTS` | d checkpoint | `bundle/models/d/b1_best.pt` |
| `TRAINED_MODEL_E_WEIGHTS` | e checkpoint | `bundle/models/e/b1_best.pt` |
| `TRAINED_MODEL_H_CAT_FULL` / `_ART` | h full/art catalogs | `bundle/catalog/h/cat_*_b1.npy` |
| `TRAINED_MODEL_D_CAT_FULL` / `_ART` | d catalogs | `bundle/catalog/d/…` |
| `TRAINED_MODEL_E_CAT_FULL` / `_ART` | e catalogs | `bundle/catalog/e/…` |
| `TRAINED_MODEL_CAT_IDS` | shared 20339-ID list | `bundle/catalog/cat_ids.json` |
| `TRAINED_MODEL_CATX_NAMES` | extra id→name (optional; else `catalog/catx_names.json` next to `cat_ids.json`) | `bundle/catalog/catx_names.json` |
| `TRAINED_MODEL_FUSION_WEIGHTS` | h,d,e fusion weights | `2,1,1` → `(2h+d+e)/4` |
| `TRAINED_MODEL_ACCEPT` | cosine accept (post-OCR) | `0.68` |
| `TRAINED_MODEL_MARGIN` | top1−top2 margin | `0.02` |
| `TRAINED_MODEL_OCR_W` | name-OCR additive boost | `0.15` |
| `TRAINED_MODEL_NUM_W` | collector-number OCR boost | `0.10` |

Pass OCR tokens on `POST /v1/match` as `name`/`names` and `number`/`numbers`. Exact-ID pick (not name-pooled).

### Printing reranker (r21rr)

| Variable | Meaning | Ship value |
|---|---|---|
| `PRINT_RERANK_ENABLED` | master switch | `1` |
| `PRINT_RERANK_MODEL` | frozen logistic JSON | `bundle/reranker/model_frozen.json` |
| `PRINT_RERANK_FAM` | same-name families | `bundle/reranker/fam.json` |
| `PRINT_RERANK_HR_CAT` | `{tcgdexId}.jpg` scans | `bundle/reranker/hr_cat` |
| `PRINT_RERANK_THRESHOLD` | override only if `p > t` | `0.9` |
| `PRINT_RERANK_TOPK_SAME_NAME` | family candidates | `6` |

If the reranker model/hr_cat is missing, the sidecar serves fusion-only (warning, no crash). A throw on a frame keeps the fusion pred.

### Legacy single-model (rollback)

Keep `TRAINED_MODEL_WEIGHTS` / `_CAT_FULL` / `_ART` / `_CAT_IDS`. Do **not** change accept/margin defaults for this path (`0.68` / `0.02`).

## OTA updates (EAS Update)
`expo-updates` is installed (`apps/mobile`, SDK 57). Config was already in place; OTA still needs a **rebuild** of each native binary so the module is in the IPA/APK:
- `app.json`: `runtimeVersion: { "policy": "fingerprint" }` (Dev Ops: a native change gets a new runtime automatically) and `updates.url` (`https://u.expo.dev/<EAS project id>`). `updates.enabled` is true, `checkAutomatically` is `ON_LOAD`, `fallbackToCacheTimeout` is 0.
- `eas.json` channels match the profiles: `development`, `preview`, `production`.
- **Expo Go still works.** `npx expo start` loads JS from Metro. Expo Go already includes `expo-updates`; it ignores this project's fingerprint `runtimeVersion` and EAS channels. Do not call `Updates.reloadAsync` / `checkForUpdateAsync` on the Expo Go path (Sentry reads `Updates.channel` only when not in Expo Go).
- After the next EAS **rebuild**: publish with `eas update --channel production --message "..."`. Same for `preview` and `development`. Roll back with `eas update:republish`.

## TestFlight (iOS)
First iOS TestFlight is an EAS `preview` or `production` iOS build (Apple Developer account). Do not treat this as a store submit or a Railway deploy.

### Privacy manifest
`apps/mobile/app.json` `ios.privacyManifests` is compiled into the app target's `PrivacyInfo.xcprivacy` on prebuild. There is no committed `PrivacyInfo.xcprivacy`. After an EAS iOS build, download the IPA and confirm the file is in the bundle:

```sh
unzip -p *.ipa 'Payload/*.app/PrivacyInfo.xcprivacy'
```

Expect `NSPrivacyTracking` false, empty `NSPrivacyTrackingDomains`, and:

**Collected data** (from the app and https://pokesniper.app/privacy — not tracking; no extra types):
- `NSPrivacyCollectedDataTypeEmailAddress` — sign-in / sign-up; linked; App Functionality.
- `NSPrivacyCollectedDataTypeUserID` — account id and community handle; linked; App Functionality.
- `NSPrivacyCollectedDataTypePhotosorVideos` — scan/grade photos, and (Terms) scan photos kept temporarily for PokeSniper's own matcher; linked; App Functionality + Other (training).
- `NSPrivacyCollectedDataTypeCrashData` — Sentry, opt-in Send crash reports; **not** linked; App Functionality.

**Required-reason APIs** (app code + local `cardflow-live-video` + Expo modules statically linked into the app; SDK-only reason codes such as `0A2A.1` stay on the SDK manifests):
- `UserDefaults` `CA92.1` — app-only defaults. The app uses SecureStore, not AsyncStorage; `expo-updates` writes OTA config to `UserDefaults.standard`, and Expo/RN do the same for app-only settings. No App Group (`1C8F.1`).
- `FileTimestamp` `C617.1` — metadata of files in the app container (`expo-file-system` `File.exists` / write / delete on `Paths.document` and `Paths.cache`: scan queue, write queue, catalog snapshot, item index, account-deletion photo cleanup).
- `SystemBootTime` `35F9.1` — elapsed time / timers. `expo-device` is imported (runtime + perf) and declares this; React Native's timing code does too. Local live-video uses `CFAbsoluteTimeGetCurrent` / `CACurrentMediaTime`, which are not required-reason APIs.

Not declared: disk space (the app never queries free/total space) and active keyboards (`KeyboardAvoidingView` is not `activeInputModes`).

`npx expo config --type public` (from `apps/mobile`) prints the same `ios.privacyManifests`. `npx expo prebuild --platform ios --no-install` in a throwaway copy writes `ios/PokeSniper/PrivacyInfo.xcprivacy`; do not commit that `ios/` tree.

## Sentry
- **Off without a DSN:** `initMobileSentry()` returns before `require("@sentry/react-native")`. It also returns when Settings > **Send crash reports** is off (off by default; opt-in; turning it off closes the client right away).
- Dev builds never send (`enabled: !__DEV__`). Events carry `environment` (`EXPO_PUBLIC_SENTRY_ENVIRONMENT` if set, else the expo-updates channel on a native build, else `EXPO_PUBLIC_APP_ENV`; those names match the EAS channels), `release` (`app.pokesniper.mobile@<version>+<build>`) and `dist` (build number). See `sentryReleaseTags` in packages/shared. Expo Go does not read `Updates.channel`.
- **Scrubbing:** `sendDefaultPii: false`; no screenshots, view hierarchy, replay, tracing or failed-request capture. `beforeSend` runs `scrubSentryEvent`, which drops:
  - request bodies, cookies, and the `Authorization` and `X-CardFlow-App-Key` headers;
  - emails, IP addresses, bearer tokens, and JWT-like or long base64 blobs, including ones embedded in longer strings;
  - token/code/password/key query values, local photo URIs, and any key ending in `token`, `secret`, `password` or `apiKey`/`api_key`.
- **Consent:** crash reports are **not** tied to the analytics opt-in (existing rule, PRIVACY_DATA_MAP §14). They are **opt-in** (`CRASH_REPORTS_DEFAULT_ON = false` in `packages/shared/src/crash-reports.ts`); Sentry is not initialized until the user turns them on.
- **`SENTRY_DISABLE_AUTO_UPLOAD=true`** is set in the preview and production eas.json env, so EAS builds don't try to upload source maps without credentials and fail. Remove it once `SENTRY_AUTH_TOKEN` (plus `SENTRY_ORG` and `SENTRY_PROJECT`) is an EAS **secret**. Step-by-step: [SENTRY.md](./SENTRY.md#source-map-upload-steps).

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
- Privacy labels: see STORE_PRIVACY_LABELS.md (includes Diagnostics > Crash Data). The IPA privacy manifest is under [TestFlight (iOS)](#testflight-ios).

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

## Sign in with Apple / Google (API, Sean Oct 19)

| Variable | What it does | Unset means |
|---|---|---|
| `CARD_FLOW_APPLE_SIGNIN` | `true` turns on `POST /v1/sessions/social` for Apple | Apple off (button hidden) |
| `CARD_FLOW_APPLE_AUDIENCES` | Comma list of allowed Apple token audiences | `app.pokesniper.mobile` (add `host.exp.Exponent` only for Expo Go testing) |
| `CARD_FLOW_GOOGLE_CLIENT_IDS` | Comma list of Google OAuth client IDs (iOS, Android, web) accepted as token audience | Google off (button hidden) |

| `CARD_FLOW_APPLE_TEAM_ID` | Apple Developer Team ID (Apple token exchange + revoke) | Apple stays off |
| `CARD_FLOW_APPLE_KEY_ID` | Key ID of the Sign in with Apple `.p8` key | Apple stays off |
| `CARD_FLOW_APPLE_PRIVATE_KEY` | **Secret.** Contents of the `.p8` key (PEM; `\n` escapes allowed). Railway sealed variable. | Apple stays off |
| `CARD_FLOW_APPLE_CLIENT_ID` | Apple client ID for token exchange/revoke | `app.pokesniper.mobile` |

Apple sign-in is only offered when `CARD_FLOW_APPLE_SIGNIN=true` **and** the three Apple key variables are set, because account deletion must revoke the user's Apple token (App Review 5.1.1(v)). Apple refresh tokens are stored AES-GCM encrypted with a key derived from `CARD_FLOW_SERVER_PEPPER`, and revoked + deleted with the account. Google client IDs are not secrets. Tokens are verified against Apple's and Google's public JWKS.

## Training capture (Sean, Oct 25)

| Variable | Default | Notes |
| --- | --- | --- |
| `CARD_FLOW_TRAINING_CAPTURE_ENABLED` | off in production, on elsewhere | **Production kill switch.** Keep confirmed Scan a Card photos to train PokeSniper's own matcher. Leave unset/false in production until storage is secure and store privacy labels are updated. |
| `CARD_FLOW_TRAINING_RETENTION_DAYS` | `180` | Days to keep training samples before auto-deletion. Keep in sync with Terms if changed. |

**Safeguards (ported from PR 117):**
- **Kill switch**: `CARD_FLOW_TRAINING_CAPTURE_ENABLED` must be explicitly `"true"` in production. Unset = off in production (safe default), on in dev/staging.
- **Eligibility**: Only non-guest accounts that confirmed 18+ and accepted the current Terms version. Guests are never captured.
- **CardSight exclusion**: Never keep samples where CardSight was the top answer OR appeared anywhere in shown candidates. We don't own CardSight's outputs.
- **Private file permissions**: Directories 0700, files 0600.
- **Pseudonymous export**: User IDs are HMAC-hashed (with `CARD_FLOW_SERVER_PEPPER`) in exports and database records.
- **Guest cleanup**: Training samples and opt-out records deleted on account deletion.
- **Retention**: Soft delete with 30-day grace period (can be restored within 30 days), then physical deletion.

Training images are stored separately from regular scans/grades, with EXIF/GPS stripped. Live Scan video frames are never kept (Whatnot's terms). Grade photos follow their existing 24h retention policy.

Users consent via Terms acceptance (ON by default) and can opt out in Settings > Card recognition > Help improve card recognition. Opt-out stops new capture and deletes existing samples.
