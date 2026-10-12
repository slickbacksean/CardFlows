"""Fit the finder's accept threshold on the held-out synthetic validation split.

    python3 train/calibrate.py --art 'ART/*.jpg' --tex 'TEX/*.jpg' --n 600

Validation art is the `val` split of train/art-list.tsv (never trained on, and no
baseline/test-set cards). Picks the lowest confidence threshold at which wrong crops
(quad IoU < 0.85 against the true mask, or any card "found" in an empty frame) are
at most 1% of accepted samples, and writes models/card-finder.threshold.json.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from synth import Synth  # noqa: E402
from train import art_ids  # noqa: E402


def main() -> None:
    import finder as finder_mod

    ap = argparse.ArgumentParser()
    ap.add_argument("--art", required=True)
    ap.add_argument("--tex", required=True)
    ap.add_argument("--n", type=int, default=600)
    ap.add_argument("--max-wrong", type=float, default=0.01)
    args = ap.parse_args()
    model = finder_mod.CardFinder.load()
    synth = Synth(args.art, args.tex, 512, seed=987654, art_ids=art_ids("val"))
    rows = []
    for _ in range(args.n):
        img, mask = synth.sample()
        found = model.find(img)
        has_card = mask.any()
        if found is None:
            rows.append((0.0, has_card, False))
            continue
        poly = np.zeros_like(mask)
        cv2.fillPoly(poly, [np.round(found.corners).astype(np.int32)], 1)
        inter = float((poly & mask).sum())
        union = float((poly | mask).sum())
        iou = inter / union if union else 0.0
        cut = "corner_cut_off" in found.reject_reasons
        rows.append((0.0 if cut else found.confidence, has_card, has_card and iou >= 0.85))
    best = None
    for t in np.round(np.arange(0.30, 0.99, 0.01), 2):
        acc = [r for r in rows if r[0] >= t]
        if not acc:
            continue
        wrong = sum(1 for r in acc if not r[2]) / len(acc)
        recall = sum(1 for r in acc if r[2]) / max(1, sum(1 for r in rows if r[1]))
        if wrong <= args.max_wrong:
            best = {"accept_threshold": float(t), "val_wrong_accept_rate": wrong, "val_recall": recall,
                    "val_samples": len(rows), "val_with_card": sum(1 for r in rows if r[1])}
            break
    if best is None:
        raise SystemExit("no threshold meets the wrong-crop bar on validation")
    best["split"] = "synthetic val (train/art-list.tsv split=val, seed 987654)"
    out = HERE.parent / "models" / "card-finder.threshold.json"
    out.write_text(json.dumps(best, indent=2) + "\n")
    print(json.dumps(best, indent=2))


if __name__ == "__main__":
    main()
