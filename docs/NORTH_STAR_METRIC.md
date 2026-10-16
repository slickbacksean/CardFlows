# North Star metric (D10 / P1-20)

**Cards marked Purchased per weekly active reseller.** Approved by Sean (D10).

## Definition
- **Week:** ISO week, Monday 00:00 UTC to Sunday 23:59 UTC. Reported by `weekStart` (the Monday's date).
- **Purchased cards:** inventory rows with intent `purchased` whose `purchasedAt` falls in the week (one per physical copy, including livestream Purchased taps). Watchlist rows don't count. A row that was later deleted stops counting.
- **Weekly active reseller:** a signed-in account (not a guest) with at least one scan or one Purchased card that week.
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
- Today the account list is the invited beta testers. When guest sessions (D9) ship, guests are excluded until they sign up; their scans move to the new account and count from then on.
- Computed on request from the store; cheap at beta scale. Add a weekly snapshot table before ~10k users.
