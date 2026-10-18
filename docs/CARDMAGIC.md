# CardMagic hybrid card finder (Sean, Oct 18)

Estimate only. Not an official grade.

## Split

| Path | Who | When |
|---|---|---|
| **CardMagic** (CardSight) | Server, saved grading photos | `CARD_FLOW_CARDMAGIC=on` + `CARDSIGHT_API_KEY` + signed-in + 18+ + current CardSight consent + monthly cap room |
| **CardFlow card finder** | Server fallback + on-device live auto-capture | Always available; used when CardMagic is off, declines, errors, times out (~8s), or returns `NO_CARD_FOUND` |

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

## Flags

```
CARD_FLOW_CARDMAGIC=on   # default off
CARDSIGHT_API_KEY=…      # shared with identify
```

CardMagic counts against the same per-user monthly CardSight cap as identify (and the global budget when that gate is on).

## User copy

Grade guidelines ask users to take the card out of any slab or toploader before grading. CardSight disclosure (version `2026-10-18.1`) says photos may be sent to identify cards and to crop/straighten grade photos.

## Docs

- https://cardsight.ai/solutions/cardmagic
- https://api.cardsight.ai/documentation
- npm `cardsightai` README (CardMagic section)
