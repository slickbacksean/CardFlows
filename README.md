# CardFlow

Private-beta monorepo for Pokémon card flipping: scan → confirm → Max Buy → inventory.

## Packages

| Package | Path | Description |
|---------|------|-------------|
| `@cardflows/mobile` | `apps/mobile` | Expo app (iOS/Android) |
| `@cardflows/api` | `packages/api` | API/BFF with mock CardSight + TCGdex providers |
| `@cardflows/shared` | `packages/shared` | Types, Max Buy calculator, JSON fixtures |

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9

## Setup

```bash
pnpm install
pnpm build
```

## Run tests

```bash
pnpm test
```

## Development

```bash
# API (mock providers, port 3001)
pnpm dev:api

# Expo app
pnpm dev:mobile
```

Set `EXPO_PUBLIC_API_URL` to point the mobile app at the BFF (default `http://localhost:3001`).

### Mock scenarios

| Env var | Values |
|---------|--------|
| `CARDSIGHT_MOCK_SCENARIO` | `high-confidence`, `ambiguous`, `no-card`, `error`, `rate-limit` |
| `TCGDEX_MOCK_SCENARIO` | `card`, `high-map`, `no-match`, `ambiguous` |

## Build slices

### Slice 1 (merged)

- Mock recognition (`cardsight-*.json` fixtures)
- Mock catalog/mapper (`tcgdex-*.json` fixtures)
- Max Buy: `reference × 0.80 × 0.87 × condition_factor` → round half up to cent
- No live CardSight or TCGdex HTTP

### Slice 2 — scan → confirm

- Mobile: still-image capture or photo library pick → BFF `/v1/scans` (mock identify + map)
- Confirm screen: High (one proposal), ambiguous (picker + manual search), no-match/error (manual search)
- On Confirm only: mint/reuse `cardflow_card_id` for `{language, tcgdex_id}`
- Local persistence: SQLite API dev store at `packages/api/.cardflows-dev/store.db` (scan + confirmation rows)
- Reject keeps the scan; does not mint an id

See `docs/IMPLEMENTATION_BRIEF.md` for product rules.
