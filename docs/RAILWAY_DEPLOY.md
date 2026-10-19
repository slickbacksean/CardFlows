# CardFlow API on Railway (SQLite on a volume + Litestream)

Status: implemented in the repo (draft PR); **nothing is deployed and no accounts exist yet**. Sean does the account steps in "What Sean does" below. Source plan: Dev Ops, Oct 17, 2026.

What the repo does now:
- `apps/api/docker/entrypoint.sh`: starts as root only to chown the root-mounted volume, then drops to `app` (uid 10001) with `gosu`; volume guard; maintenance mode; Litestream restore-if-missing; migrations once per deploy under `flock` with a pre-migration copy in `/data/pre-migrate/` (keep 3, max 14 days); then `litestream replicate -exec node` (or plain node when backups are off).
- `apps/api/docker/litestream.yml`: Litestream v0.5.17 (pinned + sha256 in the Dockerfile), env-only config.
- Every SQLite connection: `busy_timeout=5000`, `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`; migrations turn FK off and back on in a `try/finally` (`src/db/sqlite-pragmas.ts`, `src/db/migrate.ts`).
- Production refuses to start on Railway when the DB isn't on the volume, or when `CARD_FLOW_BACKUPS_REQUIRED=true` and the `LITESTREAM_*` bucket/keys are missing (`src/production-config.ts`).
- `/health` adds `db: {ok, journalMode}` (503 when the DB is broken) and `backups: {litestream}` (mode only; replication lag never fails /health).
- SIGTERM/SIGINT: stop accepting requests, up to 10 s for in-flight work, close SQLite (checkpoints WAL), exit.
- `CARD_FLOW_MAINTENANCE=1` runs `src/maintenance.ts` (no DB; /health 200, all else 503 + Retry-After).
- CI `api-image`: also boots the image on a root-owned volume, checks ownership, WAL, restart survival and the volume guard.

Not in this PR yet (follow-ups, see the source plan §6, §7 A, §8.5): the in-app nightly DB snapshot + photo mirror to the bucket (`@aws-sdk/client-s3`), `restore-photos.ts`, `GET /ops/db-stats`, and the `backup_failed` / `volume_low` ops alerts. Until then, DB backups are Litestream (continuous, 90 days) plus Railway Daily volume backups (6 days); **photos are only covered by the Railway volume backup**.

## Railway project layout

### 1.1 Config mechanism (verified Oct 17, 2026)
- **Don't add `railway.json` or `railway.toml`.** Config as Code is deprecated. Railway says "New services cannot opt into Config as Code", and existing files stop being read on **2026-12-01** (hard cutoff). The replacement is **Infrastructure as Code** at `.railway/railway.ts`, applied with the Railway CLI (`railway config pull | plan | apply`). See docs.railway.com/infrastructure-as-code and /reference.
- **Launch decision:** the **Railway dashboard is the source of truth** for this service. The settings table below is the spec, and `docs/RAILWAY_DEPLOY.md` (new) mirrors it. Adopting IaC comes *after* Sean creates the project: run `railway config pull` against the real project, commit the generated `.railway/railway.ts`, and from then on change settings only through `railway config plan/apply`. Don't hand-write `railway.ts` before the project exists. Its plan has to be diffed against real state, and the IaC reference I checked doesn't document restart policy, draining seconds, watch paths or cron fields.
- **Pre-deploy command: don't use it for migrations.** Railway docs say: "Pre-deploy commands execute in a separate container from your application. Changes to the filesystem are not persisted and **volumes are not mounted**." It also says reading or writing the volume "should instead be done as part of the start command." So migrations run in the container entrypoint (§3).

### 1.2 Layout
```
Project: cardflow                     (Sean creates; Hobby plan)
├─ Environment: production
│   └─ Service: api   (GitHub slickbacksean/CardFlows, Dockerfile build)
│        └─ Volume: api-data → mounted at /data  (5 GB, us-west2)
└─ Environment: staging
    └─ Service: api   (same service, separate deployment)
         └─ Volume: api-data → /data (its own volume; volumes are per environment)
Backups (outside Railway, recommended): Cloudflare R2
    cardflow-backups-production   cardflow-backups-staging
Optional, later: Environment "drill" (temporary, for restore drills §7.B; delete after use)
```
- **PR environments: OFF.** Each one would get its own volume, no backups, and the deploy secrets.
- Railway Buckets are the alternative to R2 (§5.4). They'd sit on the project canvas, and each environment automatically gets its own bucket instance with isolated credentials.

### 1.3 Service settings (dashboard)
| Setting | Value | Why / notes |
|---|---|---|
| Source | GitHub `slickbacksean/CardFlows`. **Root Directory unset** (repo root is the build context). | The Dockerfile copies `packages/shared`, `patches`, the lockfile, etc. from the repo root. |
| Builder | Dockerfile | |
| Dockerfile path | Service variable `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile` | Documented Railway variable for non-root Dockerfiles. |
| Branch / deploy trigger | staging tracks `main` and auto-deploys. production tracks a `production` branch: promote with `git push origin main:production` (fast-forward only). Enable "Wait for CI" on both so a deploy waits for GitHub checks. | Keeps production deploys deliberate. *Unverified:* the exact name of the wait-for-CI toggle in the current dashboard. |
| Watch paths | `apps/api/**`, `packages/shared/**`, `pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml`, `patches/**`, `.npmrc`, `tsconfig*.json` | Mobile-only commits don't redeploy the API. |
| Region | `us-west2` (US West Metal, California) for both environments | Sean and the launch users are in the US, West Coast first. The volume follows the service region, and changing region later means downtime while the volume migrates. |
| **Replicas** | **1** (both environments). Never enable horizontal scaling or multi-region. | (1) Railway: "Replicas cannot be used with volumes". (2) SQLite is single-writer, and Litestream supports exactly one writer per replica path. (3) Grade jobs (PR 76), rate limits, caches and the grade queue are in memory per process. The trigger to move to Postgres is needing >1 instance. |
| Healthcheck path | `/health`, timeout `120` s | Railway gates a deploy on a 200. `/health` already fails (503) when the grader is broken. §8.3 adds a DB check. Startup can include a Litestream restore of an empty volume, which takes seconds for a small DB, so 120 s leaves headroom. |
| Restart policy | `ON_FAILURE`, max retries `10` | If node or Litestream crashes, the container restarts. `ALWAYS` would also restart on intentional clean exits; not needed. |
| Draining seconds (teardown) | `30` | SIGTERM → SIGKILL gap. It covers the node shutdown (§8.1) plus Litestream's final sync (`shutdown-sync-timeout: 20s`). |
| Overlap seconds | leave default/0 | Railway already prevents two deployments mounting the same volume, so there's a few seconds of downtime per deploy. Accepted. |
| Resources | Memory limit **2 GB**, vCPU limit 2 | One grade peaks at about 1 GB (`docs/API_DEPLOY.md`). Hobby allows up to 48 GB per service. Billing follows actual use, not the limit. |
| Public networking | Railway-generated `*.up.railway.app` domain on port 8080. Optional custom domain `api.<domain>` (§10). | Hobby allows 2 custom domains. |
| Volume backups (Railway built-in) | Enable **Daily only** (kept 6 days) | A cheap third layer, but it can only restore into the same project and environment. Weekly (27 days) and Monthly (89 days) also fit the 90-day backup window; do not keep volume backups longer than 90 days (§6.4). |

## Paths, volume, permissions

### 2.1 Paths
- Volume mount path: **`/data`** (both environments). Railway then injects `RAILWAY_VOLUME_MOUNT_PATH=/data` and `RAILWAY_VOLUME_NAME`.
- `CARD_FLOW_SQLITE_PATH=/data/cardflow.sqlite` (already the image default; also set it explicitly in Railway variables).
- That puts photos at `/data/scans/*` and `/data/grade/*`, so they're on the volume automatically.
- Litestream metadata goes to `/data/.cardflow.sqlite-litestream/` (its default location next to the DB, on the volume).
- Pre-migration copies go to `/data/pre-migrate/` (§3.3).
- Locks: `/data/.migrate.lock`.

### 2.2 Guard against silently writing to ephemeral disk
Add `sqliteVolumeProblem(env)` in **`apps/api/src/production-config.ts`** and call it from `productionConfigProblems`:
```ts
// Railway sets RAILWAY_ENVIRONMENT_NAME at runtime. On Railway in production, the DB must live on the volume.
export function sqliteVolumeProblem(env: Env): string | null {
  if (env.NODE_ENV !== "production") return null;
  if (env.CARD_FLOW_REQUIRE_VOLUME === "false") return null;            // escape hatch (CI, local docker)
  if (!env.RAILWAY_ENVIRONMENT_NAME && env.CARD_FLOW_REQUIRE_VOLUME !== "true") return null; // not on Railway
  const mount = env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  const db = path.resolve(env.CARD_FLOW_SQLITE_PATH ?? "");
  if (!mount) return "No Railway volume is mounted: attach a volume at /data before deploying (the DB would be lost on redeploy).";
  if (!db.startsWith(path.resolve(mount) + path.sep)) return `CARD_FLOW_SQLITE_PATH (${db}) must be inside the volume (${mount}).`;
  return null;
}
```
The entrypoint (§3.2) does the same check in shell before any restore or migration, so a misconfigured service fails fast instead of restoring into a throwaway disk on every boot. *Verify on the first staging deploy* that `RAILWAY_ENVIRONMENT_NAME` is present at runtime. Railway documents it as a provided variable.

### 2.3 Permissions (root-mounted volume vs non-root image)
Railway docs: "Volumes are mounted as the root user. If you run an image that uses a non-root user, you should set `RAILWAY_RUN_UID=0`." **Don't use `RAILWAY_RUN_UID=0`.** It runs node, Python/OpenCV and Litestream as root for the life of the container. Instead:
1. Remove `USER app` from the runtime stage, so the container starts as root.
2. Install `gosu` (`apt-get install -y --no-install-recommends gosu`, which is in Debian bookworm).
3. `apps/api/docker/entrypoint.sh` runs as root only long enough to `mkdir -p` and `chown app:app` the data dir. It chowns only entries not already owned by `app`, so it stays fast as the volume grows: `find "$DATA_DIR" -xdev \! -user app -exec chown app:app {} +`. Then it `exec gosu app "$0" "$@"`, and everything else (restore, migrate, Litestream, node, Python grader) runs as uid 10001.
4. In CI and local `docker run` with no volume, `/data` is already owned by `app`, so the chown is a no-op and the job keeps passing.

Fallback if `gosu` is unwanted: `setpriv --reuid=10001 --regid=10001 --clear-groups` from util-linux. Check that it exists in `python:3.12-slim-bookworm` before relying on it. Last resort: `RAILWAY_RUN_UID=0`, documented as a known weakening.

## Variables

### 9.1 Railway: per environment (values differ between staging and production)
Railway-provided (don't set): `RAILWAY_VOLUME_MOUNT_PATH`, `RAILWAY_VOLUME_NAME`, `RAILWAY_ENVIRONMENT_NAME`, etc. Use Railway **sealed** variables for secrets where available.

| Variable | staging | production | Secret? | Notes |
|---|---|---|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `apps/api/Dockerfile` | same | no | build |
| `NODE_ENV` | `production` | `production` | no | image default; staging also runs production mode so the guards apply |
| `PORT` | `8080` | `8080` | no | |
| `CARD_FLOW_SQLITE_PATH` | `/data/cardflow.sqlite` | same | no | |
| `CARD_FLOW_TRUST_PROXY_HOPS` | `1` | `1` | no | *Verify* in staging that the client IP shows up correctly (Railway's edge adds one `X-Forwarded-For` hop) |
| `CARD_FLOW_SERVER_PEPPER` | random ≥32 | **different** random ≥32 | **yes** | PR #96; production refuses to start without it |
| `CARD_FLOW_OPS_TOKEN` | random | random | **yes** | `/ops/*` |
| `CARD_FLOW_APP_API_KEY` | value | value | low (speed bump; it ships in the app as `EXPO_PUBLIC_CARD_FLOW_APP_KEY`) | |
| `CARD_FLOW_EMAIL_SENDER` / `CARD_FLOW_EMAIL_FROM` / `RESEND_API_KEY` | resend / sender / key | same | key = **yes** | sign-ups can't verify without these (separate launch dependency) |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` | dsn / `staging` | dsn / `production` | DSN low | |
| `CARD_FLOW_ALERT_WEBHOOK_URL` | optional | Slack webhook (pending Sean's choice) | **yes** | |
| `CARD_FLOW_CORS_ORIGINS` | empty | empty | no | native apps don't need CORS |
| `CARD_FLOW_GUEST_BROWSE` | leave unset / off | leave unset / off | no | Guest look-around retired (Sean, Oct 18); app never mints guests. |
| `CARD_FLOW_INVITE_ALEX/JORDAN` | leave unset | leave unset | no | App no longer offers invite codes (Sean, Oct 18). Legacy API route only. |
| `CARDSIGHT_API_KEY` (+`CARD_FLOW_CARDSIGHT_ADAPTER=on`) | only if testing | when approved | **yes** | |
| `POKETRACE_API_KEY`, `POKEMONTCG_API_KEY` | if used | if used | **yes** | |
| PokéCollector (`CARD_FLOW_POKECOLLECTOR_URL/TOKEN/ADMIN_USERNAME/ADMIN_PASSWORD/LINK_KEY/PREVIOUS_LINK_KEYS/USER_PEPPER`) | off | off until PokéCollector is hosted and PR #97 merged | **yes** | out of scope here |
| `CARD_FLOW_LIVE_IDENTITY_OPENCLIP_URL/TOKEN` | if sidecar hosted | same | token **yes** | the sidecar isn't in this plan |
| `LITESTREAM_BUCKET` | `cardflow-backups-staging` | `cardflow-backups-production` | no | |
| `LITESTREAM_PATH` | `litestream/cardflow.sqlite` | same | no | bump the generation after a PITR restore |
| `LITESTREAM_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | same | no | |
| `LITESTREAM_REGION` | `auto` | `auto` | no | |
| `LITESTREAM_ACCESS_KEY_ID` / `LITESTREAM_SECRET_ACCESS_KEY` | staging R/W token | production R/W token | **yes** | each token scoped to one bucket |
| `LITESTREAM_REQUIRE_CONTENT_MD5` | `true` (R2) / `false` (Railway Buckets) | same | no | |
| `LITESTREAM_HEARTBEAT_URL` | optional | Healthchecks URL | low | |
| `CARD_FLOW_BACKUPS_REQUIRED` | `true` | `true` | no | boot fails if backup env is missing |
| `CARD_FLOW_BACKUP_BUCKET/ENDPOINT/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY` | reference the `LITESTREAM_*` values | same | keys **yes** | same bucket, `snapshots/` and `photos/` prefixes |
| `CARD_FLOW_BACKUP_RETENTION_DAYS` / `CARD_FLOW_BACKUP_HOUR_UTC` / `CARD_FLOW_BACKUP_HEARTBEAT_URL` | 90 / 10 / optional | 90 / 10 / Healthchecks URL | low | |
| `MAX_CONCURRENT_GRADES` / `MAX_QUEUED_GRADES` | 1 / 3 | 1 / 3 | no | revisit with a 2 GB limit |

**Must stay unset in staging and production:** `CARD_FLOW_DEV_AUTO_SESSION`, `CARD_FLOW_IAP_STUB`, `CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED` (until the license decision), `CARD_FLOW_STORE=memory`, `CARDSIGHT_MOCK_SCENARIO`, `CARDFLOW_GRADE_DEBUG_IMAGES`, `CARD_FLOW_REQUIRE_VOLUME=false`, `CARD_FLOW_MAINTENANCE` (except during a restore).
Note: `CARD_FLOW_OBB_PHASH_INDEX` and `CARD_FLOW_OBB_ONNX_PATH` point at gitignored local files. If livestream identity needs them in production, upload them to `/data/models/` with `railway volume files upload` and set the path. Out of scope for this PR; flag it to Native Mobile.

### 9.2 EAS only (mobile build env, from PR #96 `docs/RELEASE_ENV.md`)
- `EXPO_PUBLIC_API_URL` (required for preview and production): the Railway domain or `https://api.<domain>`. **Pick the custom domain before the first production iOS build** so moving off Railway later doesn't need an app update.
- `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST`, `EXPO_PUBLIC_CARD_FLOW_APP_KEY`, `EXPO_PUBLIC_APP_ENV` (set by eas.json). **All are public and inlined in the bundle.**
- EAS `secret` (build-time only, never in the bundle): `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (once source-map upload is wanted).

### 9.3 Never in the app bundle (and never committed)
Everything in §9.1 marked secret, in particular `CARD_FLOW_SERVER_PEPPER`, `CARD_FLOW_OPS_TOKEN`, all `LITESTREAM_*` and `CARD_FLOW_BACKUP_*` keys, `RESEND_API_KEY`, `CARDSIGHT_API_KEY`, `POKETRACE_API_KEY`, `POKEMONTCG_API_KEY`, the PokéCollector admin, link and pepper secrets, the OpenCLIP token, the invite codes, the Slack webhook, and the R2 read-only drill token (which stays with Sean only).

## What Sean does (in order)

Agents don't create accounts, add payment methods, create cloud resources or deploy. Everything below is Sean's, or an agent's only after Sean explicitly approves that specific action.

| # | Action | Required? | Notes |
|---|---|---|---|
| 1 | Create a Railway account (GitHub login), pick the **Hobby** plan ($5/mo) and **add a card** | **Required** | The Free/Trial tiers cap at 0.5-1 GB RAM and 0.5 GB volumes, too small for the grader |
| 2 | Install the Railway GitHub app with access to `slickbacksean/CardFlows` | **Required** | Deploys from the repo |
| 3 | Create project `cardflow`, add service `api` from the repo, set region `us-west2` and `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile`. **Don't deploy until the PR is merged.** | **Required** | |
| 4 | Create environments: `staging` (alongside the default `production`). Turn **PR environments off**. | **Required** | |
| 5 | Attach a volume at `/data` to `api` in **each** environment (5 GB) | **Required** | |
| 6 | Apply the §1.3 settings: replicas 1, healthcheck `/health` with 120 s, restart ON_FAILURE ×10, draining 30 s, watch paths, branches (staging=`main`, production=`production`), memory limit 2 GB, wait-for-CI | **Required** | Can be done with an agent driving the dashboard if Sean approves |
| 7a | **Backups, recommended: Cloudflare** account → enable R2 (may ask for a payment method; free tier covers this) → create buckets `cardflow-backups-production` and `cardflow-backups-staging` (location hint WNAM) → create 3 R2 API tokens: production **Object Read & Write** scoped to the production bucket; staging **Object Read & Write** scoped to the staging bucket; production **Object Read only** for drills (keep it private). Note the Account ID for the endpoint. | **Required (one of 7a/7b)** | Optional: an R2 lifecycle rule deleting `snapshots/` after 90 days as a backstop |
| 7b | *Alternative:* create a Railway Bucket `backups` in the project (each environment gets its own instance) and wire the `${{backups.*}}` references | (alternative to 7a) | Same-vendor risk; no lifecycle rules |
| 8 | Generate and paste the secrets into Railway variables per environment: `CARD_FLOW_SERVER_PEPPER` (`openssl rand -base64 48`, different per environment), `CARD_FLOW_OPS_TOKEN` (`openssl rand -hex 32`), `CARD_FLOW_APP_API_KEY`, the R2 keys, plus the §9.1 non-secret values | **Required** | |
| 9 | Turn on Railway **Daily** volume backups for the production volume (not Weekly or Monthly) | **Required** | |
| 10 | Email sender: Resend account + verified sending domain → `RESEND_API_KEY`, `CARD_FLOW_EMAIL_FROM` | **Required for launch** (sign-up verification), separate workstream | Needs a domain |
| 11 | Custom domain `api.<domain>`: add it in Railway and create the CNAME at the DNS host. Do it before the production EAS build. | Optional (recommended) | Hobby allows 2 custom domains |
| 12 | Healthchecks.io account (free): checks "litestream-prod" (5 min / 15 min grace) and "nightly-backup-prod" (1 day / 3 h grace) → paste the ping URLs | Optional (strongly recommended) | Replication-lag alerting depends on it |
| 13 | Uptime monitor on `/health` (UptimeRobot or Better Stack free) | Optional (recommended) | |
| 14 | Slack incoming webhook for `CARD_FLOW_ALERT_WEBHOOK_URL` | Optional (pending decision) | |
| 15 | Sentry DSN(s) for the API | Optional | |
| 16 | Review and merge the draft PR. Approve the first staging deploy, then the §8.4 survival tests, then the staging drill, then promote to production (`main:production`). | **Required** | |
| 17 | Create the temporary `drill` environment for §7 B (around Oct 27-29) and **delete it afterwards** | **Required** (launch gate) | |
| 18 | Set the EAS `EXPO_PUBLIC_API_URL` for preview and production to the final API URL | **Required** | |

Suggested timeline: PR Oct 18-20 → Railway setup (steps 1-9) as soon as possible → staging up Oct 21 → survival tests Oct 22 → staging drill Oct 23 → production up Oct 24 → production drill Oct 27-29 → submit Oct 30.

## Redeploy survival test (staging, before production)

1. Create state: one signed-up account (or invite tester), one scan with a stored still, and one graded photo. Save `/ops/db-stats` and `ls -R /data | wc -l` (over `railway ssh`).
2. **Redeploy** (same image): the counts and files are identical. Logs show `Store: sqlite (/data/cardflow.sqlite)` and **no** "restored DB from replica" line.
3. **Restart** (dashboard Restart) and **a new-commit deploy**: same checks. The logs show the node shutdown line and then Litestream's final sync, which confirms signal forwarding and the 30 s drain.
4. **Migration deploy:** deploy a branch with a throwaway additive migration *on staging only*, then revert. Check `/data/pre-migrate/` got a copy, migrations ran once (a single `applied 1 migrations` line), and a Litestream restore (§7 C) contains the new table.
5. **Volume-loss simulation:** maintenance mode, then `mv /data/cardflow.sqlite* /tmp/`, unset maintenance, deploy. The entrypoint auto-restores (`-if-db-not-exists`), and the counts match step 1 within the RPO. Run `restore-photos.ts`; the files come back.
6. **Misconfiguration guard:** temporarily detach the volume (or point `CARD_FLOW_SQLITE_PATH` at `/tmp/x.sqlite`). The deploy must **fail** with the §2.2 message. Restore the setting afterwards.

## Rollback

- **App-only (most cases):** Railway → Deployments → the previous successful deployment → Redeploy (or `git revert` and promote). It's safe even after a migration, as long as migrations stay additive (§3.3): old code ignores the newer columns and tables, and Drizzle sees nothing pending.
- **App + data:** only when data is wrong or corrupted. Use the §8.2 restore procedure; prefer the `pre-migrate` copy for a bad migration. Expect to lose writes made after the restore point, and record them.
- **Never** delete the volume to "start fresh" in production. Wiping a volume also deletes its Railway backups.

## To confirm on the first staging deploy

1. **Litestream signal forwarding** with `replicate -exec` under tini, and the final-sync timing on Railway redeploys (§5.3, test 8.4-3).
2. **Litestream picking up out-of-band migration writes** made before `replicate` starts (§3.2, test 8.4-4). The fallback is to run migrations inside `-exec` via `sh -c 'flock … migrate && exec node …'`.
3. **R2 compatibility details:** whether Litestream needs `require-content-md5: false` on R2, and whether AWS SDK v3 default checksums need `requestChecksumCalculation: "WHEN_REQUIRED"` on R2/Tigris.
4. Whether **R2 requires a payment method** to enable it on a free account.
5. **Railway Bucket regions** (whether a US-West region exists) and the exact wait-for-CI toggle name.
6. **`CARD_FLOW_TRUST_PROXY_HOPS=1`** being correct behind Railway's edge. Verify by logging the resolved client IP for a known request in staging.
7. That `RAILWAY_ENVIRONMENT_NAME` is present at container runtime (used by the volume guard). The fallback is `CARD_FLOW_REQUIRE_VOLUME=true` set explicitly in Railway.
8. The Railway **cache-mount rejection** is from Railway's docs (required id format); I didn't reproduce the build failure.
9. That the Litestream release tarball contains a top-level `litestream` member (adjust the `tar` path if not).
10. `gosu` in bookworm repos, and the `flock` presence in `python:3.12-slim-bookworm` (expected via util-linux).
11. Which IaC fields cover restart policy, draining, watch paths and cron. The reference I read doesn't list them, which is why the dashboard is the source of truth for launch.
12. The cost estimate is modeled, not measured.
