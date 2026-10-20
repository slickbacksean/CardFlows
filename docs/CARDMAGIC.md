# CardMagic hybrid card finder (Sean, Oct 18)

Estimate only. Not an official grade.

## Split

| Path | Who | When |
|---|---|---|
| **CardMagic** (CardSight) | Server, saved grading photos | `CARD_FLOW_CARDMAGIC=on` + `CARDSIGHT_API_KEY` + signed-in + 18+ + current CardSight consent + monthly cap room **and** total CardSight calls this month below the ID-reserve floor |
| **PokeSniper card finder** | Server fallback + on-device live auto-capture | Always available; used when CardMagic is off, declines, hits the ID reserve, errors, times out (~8s), or returns `NO_CARD_FOUND` |

Live auto-capture stays on-device. No CardMagic on camera frames.

## Request

`POST https://api.cardsight.ai/v1/cardmagic/process`

- Multipart field `image` (the grade still after privacy strip; location/EXIF dropped; phone prep already applies orientation to pixels)
- Header `X-API-Key` (same key as CardSight identify)
- Query: `mode=process` (straightened 5:7), `autoLevels=false` (true grading color), `corners=true` (ZIP with `card_0` + four corner close-ups + sheet), `outputFormat=jpeg`

## What we use

- **`card_0`**: grading input and detect crop preview. Staged for `/v1/grade/pregrade` via `uploadId`.
- **Corner close-ups**: when detect includes a full-grade `sessionId`, stored under `/v1/grade/extra` shot names (`corner_tl` …) as advisory evidence for the extras pipeline.
- Response includes `cropPath: "cardmagic" | "local"` (logs also print `grade-cardmagic` / `grade-detect-path`).

## Flags and free-plan budget

```
CARD_FLOW_CARDMAGIC=on              # default off
CARDSIGHT_API_KEY=…                 # shared with identify
CARD_FLOW_CARDSIGHT_MONTHLY_BUDGET= # global hard stop; default 750 (CardSight free plan)
CARD_FLOW_CARDMAGIC_ID_RESERVE=     # calls reserved for card ID; default 600 when cap is 750, else ~80% of cap
CARD_FLOW_ALERT_WEBHOOK_URL=        # optional Slack webhook for ops alerts (including ~80% budget)
```

CardMagic and identify share one CardSight plan counter (`vendor_quota_usage` provider `cardsight`).

- **Card ID** may use the whole monthly cap (hard stop at the cap).
- **CardMagic** may run only while `used < cap − reserve`. With the free-plan defaults (cap 750, reserve 600) that means CardMagic stops once total calls hit 150 for the month; ID can continue up to 750. When the reserve floor is hit, detect logs `reason=id_reserve` and uses the local card finder.
- At about **80% of the cap**, OpsMetrics fires `cardsight_budget_80` (logged; posted to `CARD_FLOW_ALERT_WEBHOOK_URL` when set; 30-minute cooldown).

CardMagic also counts against the same per-user monthly CardSight cap as identify.

**Charge-on-success (Sean, Oct 18):** both the global budget and the per-user cap are charged only after a successful CardMagic (or identify) response. Errors, timeouts and 4xx/5xx do not consume a call (CardSight billing on failures is unconfirmed).

## User copy

Grade guidelines ask users to take the card out of any slab or toploader before grading. CardSight disclosure (version `2026-10-18.2`) says photos may be sent to identify cards and to crop/straighten grade photos, and that CardSight may use photos you send to improve its card recognition service.

## Docs

- https://cardsight.ai/solutions/cardmagic
- https://api.cardsight.ai/documentation
- npm `cardsightai` README (CardMagic section)
