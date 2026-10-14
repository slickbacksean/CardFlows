# Running the API outside the laptop

Checked against `apps/api` (the hosting plan was written for the old `packages/api`).

| Item | State |
|---|---|
| Runtime | Node 22 (`engines.node >=22`; `better-sqlite3@13` needs it). CI uses Node 22. |
| Start command | `node --import tsx src/index.ts` from `apps/api` (`pnpm --filter @cardflow/api start`). The API and `@cardflow/shared` run from TypeScript source through tsx, which is a production dependency. There is no separate compile step. `@types/better-sqlite3` is installed and `pnpm typecheck` is clean. |
| CI | The `api-image` job builds this image on every PR and push to main and checks that `/health` reports OpenCV ready inside it (nothing is pushed). |
| Container | `apps/api/Dockerfile` + root `.dockerignore`: Node 22 binary on `python:3.12-slim`, pinned `opencv-python-headless`, non-root user, tini, `HEALTHCHECK` on `/health`. Node deps are installed with pnpm's isolated linker so only the API's production tree goes in (the repo's hoisted linker would pull in Expo). Built and smoke-tested in CI (`api-image`); not built on the dev Mac (no Docker). |
| Platform config | Use the platform dashboard or its current IaC. Don't add `railway.toml`; Railway's config-as-code is deprecated. |
| Port | `PORT` (image default 8080, local 3001). |
| Database | `CARD_FLOW_SQLITE_PATH` (image default `/data/cardflow.sqlite`, ephemeral unless a volume is mounted). Hosted DB choice is Sean's decision. |
| CORS | `CARD_FLOW_CORS_ORIGINS` allowlist; empty allows no browser origin (native apps don't need CORS). |
| Auth | Every `/v1/*` route except `POST /v1/sessions` needs a session token. Keep `CARD_FLOW_DEV_AUTO_SESSION` unset outside local dev. |
| Health | `GET /health`; `gradeEngine` really imports `cv2` and `numpy` in the grader Python (5 s timeout). Successful probes are cached 5 min; failed probes are re-run. `/health` waits at most 3 s. HTTP 503 when the configured grader finished and failed. Every response includes `x-request-id`. |
| Crash reporting | Optional `SENTRY_DSN`. Unset is a no-op. Photos, image bytes, and emails are stripped. See [SENTRY.md](./SENTRY.md). |
| Upload limits | 22 MB per request on the grading routes (checked before parsing; the 413 copy is derived from the cap), 20 MB per photo. The API reads width/height from the JPEG/PNG/WebP header and rejects a long edge over 4032 px before any decode. The grader still uses OpenCV's reduced decode as a second line of defense, then downsizes anything over 16 MP. |
| Rate limit | Abuse limits (in memory, one instance): grades 6/min and 100/day **per client IP** and per user burst; detect has its own 20/min and 300/day bucket; whole-instance cap of 1000 grades/day (`CARD_FLOW_GRADE_*`, `CARD_FLOW_DETECT_*`). Client IP is the TCP peer unless `CARD_FLOW_TRUST_PROXY_HOPS` is set to the number of proxies in front (set it to 1 behind a single platform proxy). |
| Monthly grade quota | Per account, persisted in SQLite: **5** pre-grade estimates per UTC calendar month on free, **30** on premium, then extra credits (`grade_accounts.extra_credits`). `GET /v1/grade/quota`, `POST /v1/grade/credits/consume`. Set `CARD_FLOW_GRADE_QUOTA=false` to turn off. `CARD_FLOW_PREMIUM_USER_IDS` is a comma list overlay. |
| App API key | Speed bump, not a secret. When `CARD_FLOW_APP_API_KEY` is set, every `/v1/*` route needs `X-CardFlow-App-Key`. The Expo app sends `EXPO_PUBLIC_CARD_FLOW_APP_KEY` (works in Expo Go). |
| Extra credits IAP | Not implemented (no Apple Developer account yet). `POST /v1/grade/credits` returns "Purchases aren't available yet." unless `CARD_FLOW_IAP_STUB=true` (local/dev grant). `CARD_FLOW_IAP_ENABLED` is reserved for a future StoreKit/Play path. |
| CardSight budget | Global monthly identify cap, default 750 (`CARD_FLOW_CARDSIGHT_MONTHLY_BUDGET`), stored in `vendor_quota_usage`. The live adapter (`P1-05`) must call `consumeCardSightBudget` before a vendor identify. |
| API contract | Requests and responses are checked against `@cardflow/shared` contract schemas. Production logs mismatches and never changes a response; `CARD_FLOW_CONTRACT_STRICT=1` turns them into 500s (on by default under Vitest). See [API_CONTRACT.md](./API_CONTRACT.md). |
| Grader child env | Allowlist (PATH, LANG, HOME, TMPDIR/TMP/TEMP, OMP/OPENBLAS threads, grader flags); model keys forced empty. |
| Concurrency | `MAX_CONCURRENT_GRADES` (default 1, since one grade peaks at ~1 GB on a 2 GB instance), detect included. Up to `MAX_QUEUED_GRADES` (default 3) wait up to 30 s; a full queue answers 503 + `Retry-After`. |
| Temp files | Grader output goes to a per-request temp dir that is deleted in `finally`. Debug PNGs only with `CARDFLOW_GRADE_DEBUG_IMAGES=1`. |

Still open (Sean): hosting provider, hosted DB, photo retention, and the right `MAX_CONCURRENT_GRADES` for the chosen instance size.
