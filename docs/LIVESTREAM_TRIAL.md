# Livestream scanner trial (Sean, Oct 18–19)

## Access

| State | Who | Behavior |
|---|---|---|
| **trial** | Signed-in, 18+, within 3 days of **account creation** | Scanner works; app shows days left |
| **locked** | Trial over, not Premium | Identify/guesses → 403 `premium_required` / `livestream_scanner`. App shows: **Livestream scanner is a Premium feature, coming soon.** No purchase button (v1 hides IAP). |
| **premium** | `grade_accounts.plan = premium` or `CARD_FLOW_PREMIUM_USER_IDS` | Unlocked |

The trial clock is `user_accounts.created_at + 3 days`. It does **not** start on first scanner use or overlay guesses. Existing accounts are measured from their original creation time. Invited/dev users without a `user_accounts` row use the grade-account first-seen anchor as a stand-in.

## Endpoints

- `GET /v1/livestream/access` — status and days left. Requires signed-in + 18+. Does not mutate anything.
- `POST /v1/livestream/identify` and `GET /v1/livestream/guesses/:tcgdexId` — enforce trial/premium (same window as `/access`).

## CardSight

Livestream frames stay **in-house** (OpenCLIP / pHash). They never go to CardSight, so **no CardSight consent check** on these routes. Documented for Policy Reviewer: third-party stream frames are not uploaded to CardSight.

## Storage

No separate trial table. Migration `0026_livestream_trials` created one; `0027_drop_livestream_trials` removes it. The window is derived from `user_accounts.created_at`.

## Flag for Sean

v1 hides in-app purchases. After the trial, users see a plain locked message with no way to buy Premium in-app. Premium launch (post-v1) should unlock this feature via the existing plan check.
