# Card finder

CardFlow's trained card-outline detector (the plan's steps 1 to 3) and its scorecard.
It replaces the AGPL YOLO11n-OBB model in `apps/api/models` (not retrained) and the
vendored contour finder as the source of grading corners.

- `TESTSET.md`: the frozen real-photo test set, its shot list, and the label format
- `baseline/manifest.jsonl`: Sean's 24 earlier real shots, labeled (baseline only)
- `eval.py` + `score.py`: one scorecard per detector change, JSON under `scorecards/`
- `label_assist.py`: snaps rough corner clicks to the card's edges for labeling
- `INTERFACE.md`: the shared corners/crop contract every detector targets

```sh
python3 services/card-finder/eval.py services/card-finder/baseline/manifest.jsonl --detector classical --verbose
```

Detectors: `classical-legacy` (old 2° corner-angle gate), `classical` (warp-first
gate, this branch), `finder` (trained model).

## Tilt gate: warp first

`check_tilt()` in `apps/api/vendor/cardgrading/pipeline/detect.py` no longer rejects on
raw corner angles. It recovers the card plane from the four corners
(`pipeline/plane.py`: homography with a pinhole camera) and rejects only past
20° out of plane, which a warp can't fix well. The 2° figure is now the soft `level`
advisory. A `rectified_aspect` hard gate checks that the straightened rectangle is
63:88 (±6%).

Honest limit: geometry alone doesn't stop wrong crops. On the baseline, the warp-first
gate removes all false retakes (4 of 17 good photos before), but a whole-frame
crop and two loose crops still get accepted. Stopping those is the trained model's job.

Photos stay out of git (`photos/` is local).
