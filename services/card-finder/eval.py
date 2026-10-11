"""Detection scorecard: run a card finder over a labeled manifest.

    python3 services/card-finder/eval.py MANIFEST [--detector classical|finder|classical-legacy] [--json OUT]

Detectors
- classical-legacy: vendored contour finder with the old 2° corner-angle tilt gate (pre-fix baseline)
- classical:        vendored contour finder, warp-first tilt gate (this branch)
- finder:           CardFlow card-finder segmentation model (models/card-finder.onnx) + same gates

Every model change should be run against the frozen test set and its scorecard
JSON committed under scorecards/.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
VENDOR = HERE.parents[1] / "apps" / "api" / "vendor" / "cardgrading"
sys.path.insert(0, str(VENDOR))
sys.path.insert(0, str(HERE))

from pipeline import detect as vendor_detect  # noqa: E402
from score import make_sample, scorecards  # noqa: E402


def tags_for(row: dict) -> set[str]:
    tags = {row.get("side", "front"), row.get("finish", "bordered")}
    for key in ("background", "holder", "device"):
        if row.get(key):
            tags.add(f"{key}:{row[key]}")
    return tags


def run_classical(image, thresholds, legacy: bool):
    if legacy:
        corners = vendor_detect.find_card_contour(image)
        if corners is None:
            return None, False
        cfg = thresholds["capture"]
        tilt = vendor_detect.check_tilt(corners, cfg)
        aspect = vendor_detect.check_aspect_ratio(corners, cfg, tilt_ok=tilt.passed)
        return corners, tilt.passed and aspect.passed
    result = vendor_detect.detect_and_normalize(image, thresholds)
    if result.contour is None:
        return None, False
    return result.contour, not result.hard_failures


def run_finder(image, thresholds):
    from finder import CardFinder, gate_quad

    finder = run_finder.model = getattr(run_finder, "model", None) or CardFinder.load()
    found = finder.find(image)
    if found is None:
        return None, False
    return found.corners, found.confident and gate_quad(found.corners, image.shape, thresholds)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest", type=Path)
    ap.add_argument("--detector", default="classical", choices=["classical", "classical-legacy", "finder"])
    ap.add_argument("--json", type=Path)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    thresholds = vendor_detect.load_thresholds(VENDOR / "calibration" / "thresholds.json")
    samples = []
    for line in args.manifest.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        image = cv2.imread(str((HERE / row["image"]).resolve()))
        if image is None:
            raise SystemExit(f"missing photo: {row['image']} (photos stay local, see README)")
        if args.detector == "finder":
            corners, accepted = run_finder(image, thresholds)
        else:
            corners, accepted = run_classical(image, thresholds, args.detector == "classical-legacy")
        s = make_sample(row["image"], corners, accepted, row["corners"], tags_for(row))
        samples.append(s)
        if args.verbose:
            print(f"{Path(row['image']).name[:12]:12} found={s.found} accepted={s.accepted} "
                  f"iou={s.iou if s.iou is None else round(s.iou, 3)} err={s.corner_error if s.corner_error is None else f'{s.corner_error:.2%}'}"
                  f"{'  WRONG-ACCEPT' if s.wrong_accept else ''}{'  false-retake' if s.false_retake else ''}")
    cards = scorecards(samples)
    for name, card in cards.items():
        print("\n".join(card.lines(f"{args.detector} / {name}")))
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps({"detector": args.detector, "manifest": str(args.manifest),
                                         "cards": {k: v.as_dict() for k, v in cards.items()}}, indent=2) + "\n")
    raise SystemExit(0 if cards["all"].passes else 1)


if __name__ == "__main__":
    main()
