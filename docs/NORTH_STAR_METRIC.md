# North Star metric (D10 / P1-20)

**Cards marked Purchased per weekly active reseller.** Approved by Sean (D10).

## Definition
- **Week:** ISO week, Monday 00:00 UTC to Sunday 23:59 UTC. Reported by `weekStart` (the Monday's date).
- **Purchased cards:** inventory rows with intent `purchased` whose `purchasedAt` falls in the week (one per physical copy, including livestream Purchased taps). Watchlist rows don't count. A row that was later deleted stops counting.
- **Weekly active reseller:** a signed-in account with at least one scan or one Purchased card that week.
- **Value:** purchased ÷ weekly active resellers, 2 decimals, or `null` when nobody was active.

## Where to read it
`GET /ops/north-star?weeks=8` (1 to 52 weeks, default 8), with `Authorization: Bearer $CARD_FLOW_OPS_TOKEN`. It's 404 when the token is unset, same as `/ops/metrics`.

```json
{ "ok": true, "metric": "Cards marked Purchased per weekly active reseller",
  "weeks": [{ "weekStart": "2026-10-12", "purchased": 14, "activeResellers": 5, "perActiveReseller": 2.8 }] }
```

Only counts are returned, never user IDs or card data.

## Weekly board update
Every Monday, the TPM copies last week's row onto the CardFlow MVP board next to `docs/MVP_SUCCESS_METRICS.md`. Once PostHog is live (D7), the same number can be cross-checked against `purchased` events from opted-in users. The server number is the source of truth, because events are opt-in.

## Notes
- Today the account list is the invited beta testers and open sign-up accounts. Guest look-around is removed (Sean, Oct 18).
- Computed on request from the store; cheap at beta scale. Add a weekly snapshot table before ~10k users.
- **Deleted accounts (Backend review H2, P4):** when an account is deleted, its weekly counts (purchased, scans, and 1 active reseller per week it was active) are added to `north_star_weekly_totals` (week and counts only, no IDs) in the same transaction that hard-deletes its rows, including `purchase_events`. Both numbers (purchases/WAR and scans/WAR) are computed from live rows plus these totals, so past weeks don't change after a delete. Each account is one distinct reseller, so adding totals never double-counts.

## Companion: scans per weekly active reseller
`GET /ops/north-star` also returns `scans` and `scansPerActiveReseller` for each week, with `companionMetric: "Scans per weekly active reseller"`. It uses the same week and the same active-reseller definition. Read the two together: scans/WAR is effort and purchases/WAR is outcome. A rising scans/WAR with flat purchases/WAR points to friction between identify and buy.
