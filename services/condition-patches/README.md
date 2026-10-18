# Condition patches (step 5)

There is no usable open model for card condition, and no clean labeled data. So v1
keeps the measurement rules (centering on the warp, classical whitening for corners
and edges), and starts saving labeled close-ups to train our own classifier later.

What gets saved, per graded side, from the 1500 x 2100 canonical warp (63 x 88 mm,
about 605 dpi):
- 4 corner patches, 192 x 192 px (about 8 x 8 mm)
- 8 edge patches, 2 per side, 384 x 128 px along the edge

Labels per patch (`labels.csv`): `clean`, `whitening_light`, `whitening_heavy`,
`ding`, `bend`, `crease`, `scratch`, `not_assessable` (sleeve, glare, blur, or cut off).

Training starts at about 2,000 to 3,000 labeled patches: a tiny MobileNetV3 classifier
(Apache-2.0 timm weights). It has to beat the classical rule on the frozen test set
before it replaces anything. Pass bar: defect recall of 0.85 or more at precision
of 0.80 or more against human labels, and repeatability std of 0.5 or less over 5 shots.

Surface stays "not assessed" unless the guided angled shots pass their own eval.
Never fill a gap with a guess.

Retention: patches follow the same rule as the photos they come from (graded photos
are kept for up to 30 days). Keeping any patch longer, for training, is Sean's call;
until then, only patches from Sean's own test-set cards are kept.

```sh
python3 services/condition-patches/extract.py WARP.png OUT_DIR --id <grade-id>-front
```
