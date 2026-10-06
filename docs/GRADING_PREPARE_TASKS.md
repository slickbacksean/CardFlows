# Grading Prepare tasks (photo estimate)

Do these **in order**. One task at a time. Check the box when the “Done when” line is true.

**Job:** On Grading → Prepare, a purchased copy can show a **rough grade if submitted** (photo estimate). Submitted / Returned stay a mail-in log. CardFlow is not a grading company.

**Layout:** [TAB_LAYOUT_PLAN.md](./TAB_LAYOUT_PLAN.md) §4a.

**Later (not this file’s now-path):** [PokeTrace](https://poketrace.com/) slab market comps. Shared DTO already exists in `packages/shared/src/slab-pricing.ts`. Do not show those rows until a later founder pass.

---

## Model (honest)

**Today:** Capture’s YOLO11 Nano OBB + pHash identifies *which card* it is. That is not a condition grade. Prepare still shows an empty estimate in the app until Task 4 wires the API. Shared `CardGradingProvider` already has a **mock** fixture (CI) and an **off** adapter.

**Planned (Task 6):** a **server-only vision LLM**, default **Anthropic Claude** (the same class casecomp uses: Sonnet for card-locate, then vision scores). Key in API env only. Flag `grade_estimate_enabled`. CI stays mock. Alternatives (OpenAI-compatible vision) are allowed behind the same `CardGradingProvider` port — pick one in Task 6, do not put keys on the phone.

Not YOLO for condition. Not TCG Oracle. Not casecomp source. Not CardSight. Not MintPick / RawGraded / Viridian / HitCheck source.

---

## Process (photo estimate)

1. Tester confirms a purchased copy, opens Grading → Prepare.
2. Front still (Capture `image_storage_ref` when present) and optional back still. Catalog art is never the grade photo.
3. **Preprocess:** locate the card in the still, straighten tilt, crop the card (reuse Capture OBB crop if it already exists; otherwise send the full still).
4. **Eight subgrades** (vision later): centering, corners, edges, surface × front and back. When an L/R (and optional T/B) ratio is measured, centering is scored from a CardFlow-owned PSA-style table (`55/45` → 10, `60/40` → 9, …). Unmeasured centering stays null — never invent an 8. Corners / edges / surface may later be *capped* from defect counts; they only drop.
5. **Overall** (CardFlow-owned math, casecomp rules): `(frontAvg × 0.60) + (backAvg × 0.40)`, capped at `lowestSubgrade + 1`. Round `<0.25` down, `0.25–0.74` to `.5`, `≥0.75` up. Missing back → front-only, confidence at most Medium. `mathTrace` records the bottleneck subgrade for debugging; it is not shown as a cert.
6. Show as **estimate**, not a cert. User may override the four pillar *chips* for listing disclosure; that does not rewrite model scores. Condition chips stay user-owned.
7. Move to Submitted is allowed with or without photos. Returned grade is **typed by the user** when the slab comes back — never overwritten by the estimate.

Fail soft: no photos / flag off / model error → empty estimate, submit still works.

**Approach (do not vendor):** [casecomp](https://github.com/Pyronewbic/casecomp) internals only. MIT + Commons Clause: **no source in this repo**, no `api.casecomp.xyz`. Do **not** use [tcg-oracle-app](https://github.com/sailorpepe/tcg-oracle-app). CardFlow-owned centering table and wear caps follow published PSA-style ratios (Viridian-class) and conservative defect floors (RawGraded-class) — rewrite, do not copy those repos. Not MintPick. Not HitCheck. Not Midpoint MCP.

**Keep:** Confirm-before-inventory. USD only. Invite sessions. Watchlist cannot Prepare. Listing Copy omits notes. Marketplace automation OFF. Livestream stays live-video identity (no screenshot into Prepare).

```sh
pnpm test
pnpm typecheck
```

CI stays on **mocks**. No vision key required.

---

## Before you start

- [x] Read [TAB_LAYOUT_PLAN.md](./TAB_LAYOUT_PLAN.md) §4 (photo estimate; PokeTrace is later).
- [x] Confirm [NON_GOALS.md](./NON_GOALS.md) official-grade deferral is beaten by the founder exception **for this tab’s photo estimate only**.
- [x] Confirm Settings still has **no** AI-grading toggle, **no** PokeTrace key field, **no** Anthropic key field.

---

### Task 1 — Shared estimate DTO (+ slab DTO parked)

- [x] Done.

Touch: `packages/shared` (`grade-estimate.ts`; `slab-pricing.ts` is parked for later). Export from `packages/shared/src/index.ts`.

- `CardFlowGradeEstimate`: overall, confidence, eight subgrades, `label: "estimate"`, `notACert: true`, disclaimer.
- Pure `computeOverallGrade` using the weighting/round/cap rules. Missing back → front-only.
- `emptyGradeEstimate`. Never invent a score.
- Tab constraint + Max Buy guidance: photo estimate is not a cert. No slab copy in the UI.
- Static typical fee table (PSA/BGS/CGC/TAG) labeled **typical, not live**.
- Slab DTO + PokeTrace tier parse stay in shared for a later pass. Not rendered.

**Done when:** Unit tests cover empty states, overall math, and “not a cert.” `pnpm test` / `pnpm typecheck` pass.

**Do not:** HTTP. Vision. Settings fields. Vendor JS. Prepare slab rows.

---

### Task 2 — Prepare sheet chrome (estimate only)

- [x] Done.

Touch: [apps/mobile/app/(tabs)/grading.tsx](../apps/mobile/app/(tabs)/grading.tsx), [apps/mobile/components/ui/prepare-sheet.tsx](../apps/mobile/components/ui/prepare-sheet.tsx).

- Constraint: `Photo estimate, not a cert.`
- Prepare sheet shows the estimate block (empty is OK). **No PokeTrace / slab rows.**
- Front / back slots: “Required for a photo estimate. You can still submit without one.”
- Pillar chips remain user overrides. Condition chips remain user-owned.
- Guidance uses Max Buy copy. Typical-fee line is a label only.

**Done when:** Opening Prepare on a purchased copy shows the estimate block without a network call. Watchlist still cannot open it. Move to Submitted still works.

**Do not:** Live camera. PokeTrace UI. Writing estimate onto inventory `condition`.

---

### Task 3 — Grade provider port + mock adapter

- [x] Done.

- `CardGradingProvider.estimateGrade({ frontImage, backImage, mimeType })`.
- Mock adapter: fixture overall + subgrades when images exist, empty when they do not.
- Flag off → empty DTO, not an exception that breaks Prepare.

**Done when:** Tests never call the network. Provider name is `"mock"` in CI.

---

### Task 4 — API route (mock)

- [x] Done.

Touch: [apps/api/src/app.ts](../apps/api/src/app.ts), mobile [apps/mobile/lib/api.ts](../apps/mobile/lib/api.ts).

- `POST /v1/inventory/:id/grade-estimate` reads first-party stills (front required; back optional). 20 MB, mime enum.
- Invite session required. Watchlist item → `400` with existing watchlist copy.
- Mobile Prepare calls this and renders the DTO. Fail soft to empty.
- `/health` may add `gradeEstimate: "off" | "mock" | "vision"` — **not** keys. No `slabPricing` until the later PokeTrace pass.

**Done when:** Mock route returns the shared grade DTO. Mobile never sees a vendor URL or API key.

---

### Task 5 — Photos into the estimate

- [x] Done.

- Front slot can use Capture `GET /v1/scans/:id/image` when the purchased copy has a scan ref.
- Back slot: library / camera still stored first-party (same 20 MB / mime rules as Task 5 in [VALIDATION_ITEMS_TASKS.md](./VALIDATION_ITEMS_TASKS.md)).
- Estimate runs only after front exists. No photos → empty estimate, Move to Submitted still allowed.

**Done when:** A tester can add front + back on Prepare and get a **mock** estimate. Catalog art is never sent as the grade photo.

---

### Task 6 — Vision adapter (casecomp approach)

- [x] Done.

- Server-only. Flag `grade_estimate_enabled`. Off → mock.
- Preprocess: locate the card, straighten, crop corners (reuse Capture OBB crop if already available; otherwise a documented stub that still sends the full still).
- Eight vision calls (or one batched prompt that **returns the same 8 scores**) for centering / corners / edges / surface × front / back. Then `computeOverallGrade`.
- **Model:** Anthropic Claude vision unless Task 6 picks a documented equivalent. Key from API env only. Never Expo / SecureStore / Settings.
- Cache by image hash optional. Timeouts 8–15s. Fail soft.

**Done when:** With the flag on and a key in **API** env, a real still can return subgrades. CI stays mock. No casecomp files in the tree.

**Do not:** Copy `lib/grading/grading.js`. Device BYOK. TCG Oracle prompt/source.

---

### Task 7 — Fail-soft + honesty

- [x] Done.

Touch: Prepare sheet, About, `/health`.

- No photos / vision down: estimate empty, submit still works.
- About: photo estimate is not a cert. Stay within About length limits. No keys. No PokeTrace claim until that later pass.
- Settings: still no vendor key fields. No “AI grading” paywall row.

**Done when:** A tester can Prepare and Move to Submitted with the vision provider off.

---

### Task 8 — Loop check

- [x] Done.

- `pnpm test` · `pnpm typecheck` without vision keys.
- Manual mock: scan → confirm → Purchased → Prepare (empty or mock estimate) → Move to Submitted → Returned with **typed** cert. Estimate never becomes the returned grade. Copy listing still omits notes. USD only. No slab rows on Prepare.

**Done when:** CRM loop is intact. Prepare can show a photo estimate when mocked or flagged on.

---

## Stop here

| Later | Why not now |
|-------|-------------|
| **[PokeTrace](https://poketrace.com/) extra markets / docs polish** | Prepare now has fail-soft PSA 8/9/10, BGS 9.5, CGC 10, TAG 10 rows behind `CARD_FLOW_POKETRACE_ENABLED`. |
| PSA pop / gem-rate / cert lookup | Not required to decide send vs hold |
| Live grading-company fee API | Static typical table is enough |
| Shareable PNG report / social card | Not the mail-in CRM |
| Locations UI, audit explorer | Durable Submitted/Returned rows are in SQLite |
| casecomp / tcg-oracle source, magi scrape, LitVM notarize | License + non-goals |
| Overlay / Collection PSA 9–10 strip | Never this pass |

When PokeTrace comes back: flag `CARD_FLOW_POKETRACE_ENABLED`, server-only `X-API-Key`, `GET /v1/cards/:id/slab-estimates`, Prepare rows PSA 8 / 9 / 10, BGS 9.5, CGC 10, TAG 10, fail soft, never on drafts/overlay.

---

## Definition of done (this file)

- [x] Prepare shows a photo **estimate** (or honest empty). Slab comps are flag-gated PokeTrace rows that fail soft.
- [x] Estimate is not a cert, not listing `condition`, not the Returned grade.
- [x] Keys stay on the API. Mocks cover CI.
- [x] No casecomp or tcg-oracle source in the tree.
- [x] `pnpm test` and `pnpm typecheck` pass without vendor keys.
