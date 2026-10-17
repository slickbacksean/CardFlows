# Running the API outside the laptop

Checked against `apps/api` (the hosting plan was written for the old `packages/api`).

| Item | State |
|---|---|
| Runtime | Node 22 (`engines.node >=22`; `better-sqlite3@13` needs it). CI uses Node 22. |
| Start command | `node --import tsx src/index.ts` from `apps/api` (`pnpm --filter @cardflow/api start`). The API and `@cardflow/shared` run from TypeScript source through tsx, which is a production dependency. There is no separate compile step. `@types/better-sqlite3` is installed and `pnpm typecheck` is clean. |
| CI | The `api-image` job builds this image on every PR and push to main and checks that `/health` reports OpenCV ready inside it (nothing is pushed). |
| Container | `apps/api/Dockerfile` + root `.dockerignore`: Node 22 binary on `python:3.12-slim`, pinned `opencv-python-headless`, non-root user, tini, `HEALTHCHECK` on `/health`. Node deps are installed with pnpm's isolated linker so only the API's production tree goes in (the repo's hoisted linker would pull in Expo). Built and smoke-tested in CI (`api-image`); not built on the dev Mac (no Docker). |
| Ops metrics and alerts (P1-17) | `GET /ops/metrics` with `Authorization: Bearer $CARD_FLOW_OPS_TOKEN` returns per-route p50/p95 latency and 5xx rate (5-minute window), vendor 401/5xx counts, and recent alerts. It returns 404 when the token is unset. Alerts fire on any vendor 401/403 (bad key), 5+ vendor 5xx in 5 minutes, or an API 5xx rate of at least 5% over 20+ requests. Each alert is logged as `ops_alert`, sent to Sentry when `SENTRY_DSN` is set, and posted to `CARD_FLOW_ALERT_WEBHOOK_URL` (a Slack incoming webhook or a compatible relay) when set. Repeats are suppressed for 30 minutes. |
| On-device timings (P1-18) | The app sends sampled stage timings (20%, batched every 30 s) to `POST /v1/telemetry/perf`: grade and scan photo prep, livestream frame pull, detect, identify round trip, and frame-to-HUD. Each batch carries a bucketed device class, the model name, the OS, and the thermal state. It never includes images or card data. `/ops/metrics` shows p95 per stage and device class (24 h), the share of samples taken while the phone was hot, and the p95 when hot. Expo Go has no thermal API, so the thermal state stays `unknown` until a dev build adds one. |
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
| Server caches | In-memory, per instance. Prices are cached per TCGdex ID + variant (+ condition when sent) for 15 min. Recognition results are cached by image SHA-256 for 24 h, but only confident hits. Empty or failed answers are never cached. Every cached value carries `source` and `fetched_at` (prices return it as `fetchedAt`). `CARD_FLOW_SERVER_CACHE=0` turns both off. |
| Grader child env | Allowlist (PATH, LANG, HOME, TMPDIR/TMP/TEMP, OMP/OPENBLAS threads, grader flags); model keys forced empty. |
| Concurrency | `MAX_CONCURRENT_GRADES` (default 1, since one grade peaks at ~1 GB on a 2 GB instance), detect included. Up to `MAX_QUEUED_GRADES` (default 3) wait up to 30 s; a full queue answers 503 + `Retry-After`. |
| Temp files | Grader output goes to a per-request temp dir that is deleted in `finally`. Debug PNGs only with `CARDFLOW_GRADE_DEBUG_IMAGES=1`. |

Still open (Sean): hosting provider, hosted DB, photo retention, and the right `MAX_CONCURRENT_GRADES` for the chosen instance size.

## Forgot password needs an email sender

`POST /v1/password-resets` always answers 202 with the same message, so nobody can tell whether an email has an account. Reset codes are single use, expire after 1 hour, and only their SHA-256 is stored. A successful reset signs out every session. Delivery checks `CARD_FLOW_EMAIL_SENDER`: when it is unset, the code is logged in development only, and in production nothing is logged or sent. Wiring a provider is the remaining step (a TODO in `app.ts`).

## Production must set `CARD_FLOW_TRUST_PROXY_HOPS`

The API **refuses to start** with `NODE_ENV=production` unless this is set to a number (`0` when nothing sits in front of it).
Behind a load balancer or reverse proxy, set `CARD_FLOW_TRUST_PROXY_HOPS` to the number of proxies that append to `X-Forwarded-For` (usually `1`). With the default `0`, every request appears to come from the proxy's IP. Per-IP limits (guest mints, sign-up, sign-in, grading) then become one shared bucket. Setting it too high lets clients spoof their IP. Tests cover the default: a spoofed `X-Forwarded-For` does not reset the guest mint limit.

## Open sign-up env
- `CARD_FLOW_GUEST_SCANS=true` turns on guest sessions (3 scans, 24-hour sessions in `crm_sessions`).
- `CARD_FLOW_INVITE_ALEX` / `CARD_FLOW_INVITE_JORDAN` are tester invite codes. **There are no defaults;** unset means invite sign-in is off for that tester.
