# Full 14-photo pre-grade (Sean, Oct 18)

Estimate only. Not an official grade.

## Two grade types

| | Quick | Full |
|---|---|---|
| Photos | 2 (front flat, back flat) | 14: per side 1 flat, 2 tilted (~15-25°, opposite ways), 4 corner close-ups (TL, TR, BR, BL) |
| Free | 5 a month (code value) | **2 a month** |
| Premium | 30 a month (code value) | **25 a month** |
| Bought credits | Spent after the allowance | Not used |

The full grade is **not Premium-locked**. Its allowance is counted per account per allowance
period, with the same reset date as the quick estimates (`grade_quota_usage`, period key
`<period>#full`). A full grade spends one full grade and no quick estimate. When the full grades
run out the app says so before you start, and you can still pick the quick grade. If they run
out midway, Try again sends the same flat photos as a quick grade.

TODO: the Oct 18 tier spec says quick = 10 a month free and unlimited on Premium. The code still
uses 5 / 30 (`GRADE_QUOTA_FREE_PER_MONTH` / `GRADE_QUOTA_PREMIUM_PER_MONTH`). Change them together
with the paywall, sign-up and App Review copy. Billing was not redesigned here.

## Turning it on (dev/test flag)

`CARD_FLOW_GRADE_FULL_MODE=on` in `apps/api/.env` (off by default). Restart the API. Then
`GET /v1/grade/quota` includes `fullGrade: { monthlyLimit, usedThisMonth, remaining }` and the
Grading screen shows "Full pre-grade (14 photos)" with the number left. To test the Premium 25,
put your user id in `CARD_FLOW_PREMIUM_USER_IDS`.

## Flow

1. Flat photo of the front through the normal finder (auto-capture from the corners). Header: "Front 1/7 flat".
2. "Use this crop", then 6 guided shots ("Front 2/7" … "Front 7/7"), each with its own prompt:
   - tilted: auto-capture once the level sensor reads 15-25° and the phone is steady for 0.7 s (manual shutter if the sensor isn't there);
   - corners: manual shutter, guide box over that corner.
   Each photo is blur-checked on the phone and shown with Use / Retake. Use sends it to `POST /v1/grade/extra`.
3. Same for the back, then the grade (`POST /v1/grade/pregrade` with `fullGrade=true`).

## What the grader uses from the extra shots: nothing yet

The grade comes from the two flat photos only, same as the quick grade. The extras are accepted
(`used: false` in the response) and saved under `apps/api/data/grade-extras/<user>/` (gitignored).

- **Tilted shots:** the grader's surface step (photometric stereo) needs 3+ photos with the
  light moving relative to the card. Tilting the phone moves the camera, not the light, and two
  shots are under the minimum. The existing "rotate the card under one lamp" angled set
  (`angled_0..3`, front only) is the input that works.
- **Corner close-ups:** the grader has no close-up input. Corners and edges are measured on the
  flat photo's warp.
- **Before a launch:** no retention or cleanup for the saved extras, no link between the extras
  and the grade they belong to, and no server-side blur check (phone only).
