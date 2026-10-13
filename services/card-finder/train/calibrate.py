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


def in_frame(corners, shape) -> bool:
    """Same rule as the grader's corners_in_frame gate (0.5% border margin)."""
    h, w = shape[:2]
    m = 0.005 * max(h, w)
    q = np.asarray(corners, float)
    return bool(((q[:, 0] >= m) & (q[:, 1] >= m) & (q[:, 0] <= w - 1 - m) & (q[:, 1] <= h - 1 - m)).all())


def main() -> None:
    import finder as finder_mod

    ap = argparse.ArgumentParser()
    ap.add_argument("--art", required=True)
    ap.add_argument("--tex", required=True)
    ap.add_argument("--n", type=int, default=600)
    ap.add_argument("--model", type=Path, default=None)
    ap.add_argument("--write", action="store_true", help="write models/card-finder.threshold.json")
    ap.add_argument("--size", type=int, default=768, help="synthetic photo long side (real photos are 3-4k px)")
    ap.add_argument("--max-wrong", type=float, default=0.01)
    args = ap.parse_args()
    model = finder_mod.CardFinder.load(args.model) if args.model else finder_mod.CardFinder.load()
    synth = Synth(args.art, args.tex, args.size, seed=987654, art_ids=art_ids("val"))
    from score import polygon_iou

    rows = []  # (confidence or 0, findable, correct)
    for _ in range(args.n):
        img, _mask = synth.sample()
        x0, y0, w, h = synth.last_box
        img = img[y0:y0 + h, x0:x0 + w]  # the photo itself, so frame-border gates see real borders
        quad, findable = synth.last_quad, synth.last_findable
        quad = None if quad is None else quad - [x0, y0]
        found = model.find(img)
        if found is None or "corner_cut_off" in found.reject_reasons or not in_frame(found.corners, img.shape):
            rows.append((0.0, findable, False))
            continue
        # Correct = the accepted quad is the card (IoU>=0.85), even if partly covered.
        ok = quad is not None and polygon_iou(found.corners, quad) >= 0.85
        rows.append((found.confidence, findable, ok))
    n_find = max(1, sum(1 for r in rows if r[1]))
    sweep, best = [], None
    for t in np.round(np.arange(0.30, 0.99, 0.01), 2):
        acc = [r for r in rows if r[0] >= t]
        if not acc:
            continue
        wrong = sum(1 for r in acc if not r[2]) / len(acc)
        recall = sum(1 for r in acc if r[1] and r[2]) / n_find
        sweep.append((float(t), wrong, recall))
        if best is None and wrong <= args.max_wrong:
            best = {"accept_threshold": float(t), "val_wrong_accept_rate": round(wrong, 4), "val_recall_findable": round(recall, 4),
                    "val_samples": len(rows), "val_findable": n_find}
    for t, wr, rc in sweep[::5]:
        print(f"t={t:.2f} wrong={wr:.3f} recall={rc:.3f}")
    if best is None:
        raise SystemExit("no threshold meets the wrong-crop bar on validation")
    best["definition"] = ("recall = accepted with quad IoU>=0.85 / findable (card fully in frame, not covered by a distractor); "
                          "wrong = accepted with IoU<0.85 or on an empty/unfindable frame, over all accepted")
    best["split"] = f"synthetic val (train/art-list.tsv split=val, seed 987654, {args.size}px)"
    out = HERE.parent / "models" / "card-finder.threshold.json"
    if args.write:
        out.write_text(json.dumps(best, indent=2) + "\n")
    print(json.dumps(best, indent=2))


if __name__ == "__main__":
    main()
