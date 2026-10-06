# CardFlow

Private-beta monorepo for Pokémon card flipping: scan → confirm → Max Buy →
inventory → grade (AI pre-grade estimate) → collection.

## What the phone runs

| Package | Path | Description |
|---------|------|-------------|
| `@cardflow/mobile` | `apps/mobile` | Expo Router app (iOS/Android). This is the app on the phone. |
| `@cardflow/api` | `apps/api` | Hono API on :3001 (SQLite locally). Photo pre-grade uses the vendored, offline cardgrading library (`apps/api/vendor/cardgrading`, see `NOTICE.md`). No model call on the grade path. |
| `@cardflow/shared` | `packages/shared` | Types, Max Buy, grade-estimate contract, health, fixtures. |

Optional local services: `services/live-identity-openclip` (live-video identity
sidecar), `services/psa-grade-predictor` (experiment, not on the grade path),
`infra/pokecollector` (catalog/pricing via pinned GHCR images), `infra/huds`.

## Kept from the earlier GitHub layout (not used by the phone)

| Package | Path | Why it is still here |
|---------|------|----------------------|
| `@cardflows/api` | `legacy/api` | Holds the structured-defect pre-grade (`POST /api/v1/grading/pregrade`, `calculate-pregrade`), which `apps/api` does not have yet. Its photo routes are superseded by `apps/api` `/v1/grade/detect` and `/v1/grade/pregrade`. |
| `@cardflows/shared` | `legacy/cardflows-shared` | Dependency of `legacy/api` (CRM ids, pre-grade deduction math). Fixtures stay in `packages/shared/fixtures`. |
| — | `legacy/mobile-react-navigation` | The earlier react-navigation Expo app, including the "mark defects" manual pre-grade screens. Archived source, not in the pnpm workspace and not built. |

## Setup

```sh
pnpm install
pnpm test          # shared + API tests (mocks; no Docker / PokéCollector)
pnpm test:legacy   # legacy/cardflows-shared + legacy/api
pnpm typecheck
pnpm dev:api       # CardFlow API on :3001
pnpm dev:mobile    # Expo (Metro on :8081)
```

Photo pre-grade needs Python 3.10+ with OpenCV, NumPy, and Pillow for the API:

```sh
cd apps/api
python3 -m venv .venv
.venv/bin/pip install --only-binary=:all: -r vendor/cardgrading/requirements.txt
```

`CARDFLOW_GRADE_CARD_PYTHON` overrides the interpreter. Missing Python means the
grader reports "unavailable", never a made-up number. Results are labeled
"AI pre-grade estimate. Not an official PSA, BGS, or CGC grade."

`pnpm test` and `pnpm dev:api` do **not** require Docker. PokéCollector is
unmodified GHCR images pinned in
[infra/pokecollector/docker-compose.yml](infra/pokecollector/docker-compose.yml).
Copy [infra/pokecollector/.env.example](infra/pokecollector/.env.example) and
[apps/api/.env.example](apps/api/.env.example) locally if you want named
values — leave secrets empty and never commit `.env`.

What’s next: [docs/ROADMAP.md](docs/ROADMAP.md). Product rules:
[docs/IMPLEMENTATION_BRIEF.md](docs/IMPLEMENTATION_BRIEF.md).
