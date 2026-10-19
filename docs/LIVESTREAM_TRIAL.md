# Livestream scanner trial (Sean, Oct 18)

## Access

| State | Who | Behavior |
|---|---|---|
| **ready** | Signed-in, 18+, never used livestream | First identify/guesses call starts the 3-day trial |
| **trial** | Within 3 days of first use | Scanner works; app shows days left |
| **locked** | Trial over, not Premium | Identify/guesses → 403 `premium_required` / `livestream_scanner`. App shows: **Livestream scanner is a Premium feature, coming soon.** No purchase button (v1 hides IAP). |
| **premium** | `grade_accounts.plan = premium` or `CARD_FLOW_PREMIUM_USER_IDS` | Unlocked |

## Endpoints

- `GET /v1/livestream/access` — status only (does **not** start the trial). Requires signed-in + 18+.
- `POST /v1/livestream/identify` and `GET /v1/livestream/guesses/:tcgdexId` — start the trial on first use; enforce trial/premium afterward.

## CardSight

Livestream frames stay **in-house** (OpenCLIP / pHash). They never go to CardSight, so **no CardSight consent check** on these routes. Documented for Policy Reviewer: third-party stream frames are not uploaded to CardSight.

## Storage

Migration `0026_livestream_trials`: `user_id` PK, `started_at`. Deleted with the account.

## Flag for Sean

v1 hides in-app purchases. After the trial, users see a plain locked message with no way to buy Premium in-app. Premium launch (post-v1) should unlock this feature via the existing plan check.
