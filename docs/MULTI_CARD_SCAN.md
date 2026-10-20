# Multi-card scan (v1)

Sean (Oct 18): the **scan** screen may identify several raw Pokémon cards in one photo. **Grading stays one card.**

## CardSight billing

- Endpoint: `POST /v1/identify/card` (and `/v1/identify/card/{segment}`).
- OpenAPI (`IdentifyCardResponseInput`): `detections` is an **array** — multiple cards per image.
- Plan limits are counted in **API calls** (`SubscriptionInfoInput.calls`). Free endpoints are tagged “free” in the OpenAPI (e.g. identifiable-sets list); **identify is not**.
- cardsightai npm README: “Identify multiple cards in a single image with confidence scores” / one `identify.card()` call.
- **Conclusion:** PokeSniper counts **one CardSight budget call per identify request**, not per card in the photo.

CardSight identify does **not** return crop/bounding boxes today (IdentificationData = confidence, card, grading). `cropBox` on our detections is always `null` from CardSight.

## English only

When CardSight reports a non-English print (`CARD_LANGUAGE` / language ≠ `en`, e.g. `ja`):

- Do not map to TCGdex.
- Show: **Only English cards are supported for now.**
- User may **Skip**.
- Does **not** count toward the monthly scan allowance.

## Allowance

- Free: **30 confirmed cards / month** (UTC calendar month).
- Premium: unlimited.
- Charged **per confirmed card** (not per photo). Flag for Sean if per-photo is preferred.
- Skips / rejects / non-English do not count.

## Fallback

When CardSight is off, out of budget, or not consented, the local matcher returns at most one card and the scan may include `scanHint`: “Scan one at a time when CardSight isn't available.”

## Cap

About **9** cards per photo (`MULTI_CARD_SCAN_MAX`).

## Scan summary

After every card in a multi-card photo is confirmed or skipped, the phone opens a
**Scan summary** listing confirmed cards (thumbnail, name, set, number, raw price
when cached, Purchased state) and a skipped count. Each confirmed row opens Decide.
**Done** returns to MyDEX; **Scan another** returns to capture. Single-card scans
still go straight to Decide.

## MyDEX ownership (Sean, Oct 19)

A card shows in full color in MyDEX only when it was confirmed through Scan a Card
(single or multi-card, camera or photo library) or the user tapped Purchased in the
livestream scanner HUD. Watchlist entries, grading runs, manual Purchased saves and
Watchlist → Purchased never mark a card owned. The HUD's hidden helper scan uses
`captureMethod: "livestream_hud"` so it is not mistaken for Scan a Card; undoing the
HUD purchase clears ownership.
