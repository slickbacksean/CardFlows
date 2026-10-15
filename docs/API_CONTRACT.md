# API contract (P1-01)

One contract for every CardFlow API route lives in `packages/shared/src/contract/`, one file per route group:

| File | Routes |
|---|---|
| `health.ts` | `/health` |
| `account.ts` | sessions, identity, account photo delete, Max Buy preferences, `/v1/max-buy` |
| `catalog.ts` | catalog search, catalog card, canonical card, pricing, slab comparisons |
| `scans.ts` | Capture scans: create, read, image, confirm, reject |
| `inventory.ts` | Purchased / Watchlist, collection, portfolio, listing drafts |
| `grade.ts` | photo detect, pre-grade, Prepare estimate, grade photos, monthly quota and credits |
| `grading.ts` | sent-to-grader and returned copies |
| `livestream.ts` | overlay guesses, live-video identify, timing |

Each route is `defineRoute({ method, path, bodyKind, query?, body?, response })`. Response schemas are loose objects: extra fields pass, missing or mistyped fields fail. Domain objects reuse the existing shared interfaces through `typed<T>()`, so TypeScript and the runtime check describe one shape.

## API

`apps/api/src/contract-middleware.ts` checks every request and response.

- **Strict** (Vitest, or `CARD_FLOW_CONTRACT_STRICT=1`): a mismatch turns the response into a 500, so drift fails CI.
- **Otherwise**: the mismatch is logged once per route and issue, and the original response goes out unchanged.
- A request body is only judged when the handler accepted it (2xx). A handler's own 4xx stays as is.
- `apps/api/src/contract.test.ts` fails when a route is registered without a contract entry, or the other way round.

New route groups register in `apps/api/src/routes/<group>.ts` (`registerGradeQuotaRoutes`, `registerPreferenceRoutes` so far) instead of growing `app.ts`.

## Phone

`apps/mobile/lib/api.ts` calls everything through `callApi(apiContract.<route>, { params, query, body | form })`. Paths, methods and response types come from the contract. In development the response is checked and a mismatch is logged; users never see it and the data is returned unchanged. `packages/shared/src/contract/contract.test.ts` fails if `api.ts` hard-codes a `/v1/...` path or calls the transport outside `callApi`.

React Query is mounted in `apps/mobile/app/_layout.tsx` (`lib/query-client.ts`). Screens move to `useQuery(apiQuery(...))` one at a time; none were moved in P1-01, so behavior is unchanged.

## Adding a route

1. Add it to the right file in `packages/shared/src/contract/`.
2. Register it on the API (prefer a `routes/` module).
3. Call it from the phone with `callApi`.
