# Livestream P1 — server quick wins

Draft PR for in-house livestream scanner phase **P1** (Mobile Tech Lead plan).
Review only against recognition design in `/workspace/research/livestream-recognition-design.md`
(also summarized in agent chat). No model training.

Branched from `main` @ `e1d8fa6`. **Do not merge** until Sean says so.

## Scope

1. **Timing** — `CARD_FLOW_LIVESTREAM_TIMING=1` / `EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TIMING=1` logs
   detect, pull, upload, warp, embed, **match**, search, price, total. Summary:
   `pnpm livestream:timing` → `scripts/livestream-timing.mjs` (p50/p95 per stage).
2. **Tracker** — IoU + crop-hash, up to **3** tracks, lock after **3** identify votes,
   **recheck** every ~2.5 s or on a large hash jump, **60 s** announce dedupe.
   Frame-source agnostic (HLS or future phone-camera second screen).
3. **3-frame vote** — auto-show / "Is it one of these?" / "Waiting for a clearer view."
   Thresholds in `LIVE_VOTE_DEFAULTS` (`packages/shared/src/live-identity-vote.ts`).
4. **Push frames** — **deferred**. Native module still pull-only; TODO in
   `apps/mobile/lib/live-video-native.ts` and `live-identify.ts`. Keep the 250 ms poll.
5. **Prices** — see below.
6. **Replay harness** — `scripts/livestream-replay.mjs` + sample labels
   `scripts/fixtures/livestream-replay-labels.sample.jsonl`.

## Prices (Policy)

| Mode | Flag | Behavior |
|------|------|----------|
| **Default** | `CARD_FLOW_LIVESTREAM_PRICE_SNAPSHOT` / `EXPO_PUBLIC_…` **off** | HUD calls existing `GET /v1/livestream/guesses/:id` per card, **~10 min in-memory cache**, no bulk download. |
| **Bulk snapshot** | flag `=1` / `true` | Gated **off**. High **TCGplayer licensing risk** for on-device caching — under Policy review. This PR does not ship a bulk downloader. |
| **Link-out** | `EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TCGPLAYER_LINK=1` | HUD shows **“See prices on TCGplayer”** (public search URL) instead of the estimate. |

TCGplayer-derived market prices only (whatever the API already returns as `tcgplayer_usd`).
No CardSight pricing, no Cardmarket in the livestream HUD path.

## Conflict note (parallel draft PR)

A concurrent draft PR adds **18+ / premium / 3-day trial** checks on the livestream route
plus a CardSight count fix. This P1 PR:

- Does **not** change livestream auth or entitlement logic.
- Touches `apps/api/src/app.ts` only to attach optional `candidates` / `similarity` and a
  `match` timing stage on `/v1/livestream/identify`.
- Likely merge conflicts: `app.ts` (identify handler), possibly `packages/shared/src/index.ts`.
  Resolve by keeping both: trial gates + candidates/timing.

## Oct 30 note

The in-app Whatnot HLS scanner may be hidden for the Oct 30 build (Sean deciding).
Tracker, voting, announce dedupe, and the replay harness take **boxes + hashes + labels**
only — reusable for a phone-camera second-screen mode.

## Deferred / questions for Sean

- Native push frames (needs EAS/dev build).
- Bulk price snapshot remains off until Policy clears TCGplayer on-device caching.
- Apple Developer account still on the critical path for on-device P2 timing.
- Confirm whether the Oct 30 build hides the Whatnot HLS scanner (second-screen vs HLS).
