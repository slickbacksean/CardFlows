# Full 14-photo pre-grade (Sean, Oct 18)

Estimate only. Not an official grade.

## Two grade types

| | Quick | Full |
|---|---|---|
| Photos | 2 (front flat, back flat) | 14: per side 1 flat, 2 tilted (~15-25°, opposite ways), 4 corner close-ups (TL, TR, BR, BL) |
| Free | 5 a month (code value) | **2 a month** |
| Premium | 30 a month (code value) | **25 a month** |
| Bought credits | Spent after the allowance | Not used |

The full grade is **not Premium-locked**. Allowance is per account per period (`grade_quota_usage`, key `<period>#full`).

TODO: Oct 18 tier spec says quick = 10 free / unlimited Premium; code still uses 5 / 30.

## Turning it on

`CARD_FLOW_GRADE_FULL_MODE=on` in `apps/api/.env` (off by default).

## Flow

1. Flat front via finder. Header: "Front 1/7 flat".
2. Six guided extras with a shared **sessionId** → `POST /v1/grade/extra`.
3. Same for the back, then `POST /v1/grade/pregrade` with `fullGrade=true` + `sessionId`.

## What the grader uses from the extras

Stored under `apps/api/data/grade-extras/<user>/<sessionId>/` as `<side>-<shot>.jpg` + `meta.json`.
Server blur-check: Laplacian variance ≥ 60. **30-day** purge with graded photos; account delete wipes extras.

When `sessionId` is on pregrade, `cardflow_adapter.py --extras-dir` runs:

### Corner close-ups (`cardflow_corner_closeup.py`)

Rectify each `corner_*` still → 256×256 patch. Measure whitening/fraying and rounding/dings.
Each corner **0–10**. Findings always appear in `checkNotes` as advisory text
(e.g. `Possible whitening on top-left corner`).

**Grade impact is gated.** Close-ups lower the flat-photo corners sub-score only when
`high_confidence` (strict whitening + tip/interior mean-delta gate), and then by
**at most 1 point** (`combine_corner_scores`). Low-confidence findings stay notes-only.

`RETUNE_CORNER_CLOSEUP` — retune `CLOSEUP_LOWER_MIN_WHITENING` /
`CLOSEUP_LOWER_MIN_MEAN_DELTA` in `cardflow_corner_closeup.py` once we have real
guided phone close-ups. Current gate (wh≥35, mean_delta≥20) was chosen on
card-grader Corner Wear positives vs synthetic clean card-corner crops so
**precision ≥ 0.7** (measured **1.00**, recall **~0.019**); face-crop and
unguided-corner negatives cannot hit that bar.

### Tilted shots (`cardflow_tilt_surface.py`)

Flat + `tilt_a` + `tilt_b`: warp to canonical card, normalize, difference-of-normalized-images,
Hough/blobs → surface **0–10**, notes, mask. Not photometric stereo. Fills surface when
raking-light did not; otherwise min with photometric.

### Overall

Reassembled via `scoring.assemble_grade`. Response may include `checkNotes`.
Copy: **Pre-grade estimate** / **Estimate only. Not an official grade.** Never "AI".

## Evaluation snapshot (threshold tuning only)

Classical OpenCV only; no model training. See `apps/api/scripts/eval_full_extras.py` and
`THIRD_PARTY/ATTRIBUTION.md`.

| Set | Check | Precision | Recall | FPR | n (pos/neg) |
|---|---|---:|---:|---:|---|
| card-grader CC BY 4.0 | Corner Wear (score≤8, advisory) | 0.204 | 0.435 | 0.724 | 209/492 |
| card-grader CC BY 4.0 | Corner Wear **high-conf gate** (wh≥35 & Δ≥20, vs clean card-corners) | **1.000** | **0.019** | 0.000 | 209/600 |
| card-grader CC BY 4.0 | Scratch (score≤8) | 0.628 | 0.773 | 0.579 | 225/178 |
| pokemon-tcg-condition MIT | damage/discoloration | 0.4 | 0.185 | 0.288 | 54/52 |

### Known limits

- Card-grader Corner Wear boxes are small label crops, not phone guide-box close-ups; face-crop FPR is high (~0.72 at score≤8). That is why close-ups are **advisory by default** and only the high-conf gate can lower the corners grade (≤1 pt). Flag: `RETUNE_CORNER_CLOSEUP`.
- Tilt surface cannot match a moving lamp for holo glare vs scratches.
- pokemon-tcg-condition is tiny/noisy; numbers are directional only.
