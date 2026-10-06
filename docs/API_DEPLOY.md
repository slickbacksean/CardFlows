# Running the API outside the laptop

Checked against `apps/api` (the hosting plan was written for the old `packages/api`).

| Item | State |
|---|---|
| Runtime | Node 22 (`engines.node >=22`; `better-sqlite3@13` needs it). CI uses Node 22. |
| Start command | `node --import tsx src/index.ts` from `apps/api` (`pnpm --filter @cardflow/api start`). The API and `@cardflow/shared` run from TypeScript source through tsx, which is a production dependency. There is no separate compile step. `@types/better-sqlite3` is installed and `pnpm typecheck` is clean. |
| Container | `apps/api/Dockerfile` + root `.dockerignore`: Node 22 binary on `python:3.12-slim`, pinned `opencv-python-headless`, non-root user, tini, `HEALTHCHECK` on `/health`. **Not built yet** (no Docker on the dev Mac; disk is nearly full). |
| Platform config | Use the platform dashboard or its current IaC. Don't add `railway.toml`; Railway's config-as-code is deprecated. |
| Port | `PORT` (image default 8080, local 3001). |
| Database | `CARD_FLOW_SQLITE_PATH` (image default `/data/cardflow.sqlite`, ephemeral unless a volume is mounted). Hosted DB choice is Sean's decision. |
| CORS | `CARD_FLOW_CORS_ORIGINS` allowlist; empty allows no browser origin (native apps don't need CORS). |
| Auth | Every `/v1/*` route except `POST /v1/sessions` needs a session token. Keep `CARD_FLOW_DEV_AUTO_SESSION` unset outside local dev. |
| Health | `GET /health`; `gradeEngine` really imports `cv2` and `numpy` in the grader Python (cached 5 min). |
| Upload limits | 22 MB per request on the grading routes (checked before parsing), 20 MB per photo, photos over 16 MP downscaled before grading. |
| Rate limit | Grading routes: 6/min and 100/day per user and per client IP (`CARD_FLOW_GRADE_RATE_*`). In memory, so one instance only. |
| Grader child env | Allowlist (PATH, LANG, HOME, TMPDIR/TMP/TEMP, OMP/OPENBLAS threads, grader flags); model keys forced empty. |
| Concurrency | `MAX_CONCURRENT_GRADES` (default 2) grader processes at once, detect included; others wait up to 30 s, then get "unavailable". |
| Temp files | Grader output goes to a per-request temp dir that is deleted in `finally`. Debug PNGs only with `CARDFLOW_GRADE_DEBUG_IMAGES=1`. |

Still open (Sean): hosting provider, hosted DB, photo retention, and the right `MAX_CONCURRENT_GRADES` for the chosen instance size.
