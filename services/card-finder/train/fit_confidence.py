"""Fit the finder's confidence (logistic regression on quad features).

    python3 train/fit_confidence.py --art 'ART/*.jpg' --tex 'TEX/*.jpg' [--model X.onnx]

Fit on synthetic photos made from TRAIN-split art with their own seed, so the
validation split used by calibrate.py stays untouched. Label: the quad is the card
(IoU >= 0.85 against the true quad) and lies inside the frame.
Writes models/card-finder.confidence.json.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from calibrate import in_frame  # noqa: E402
from synth import Synth  # noqa: E402
from train import art_ids  # noqa: E402


def main() -> None:
    import finder as F
    from score import polygon_iou

    ap = argparse.ArgumentParser()
    ap.add_argument("--art", required=True)
    ap.add_argument("--tex", required=True)
    ap.add_argument("--model", type=Path)
    ap.add_argument("--n", type=int, default=800)
    ap.add_argument("--size", type=int, default=512)
    args = ap.parse_args()
    F._WEIGHTS = None
    model = F.CardFinder.load(args.model) if args.model else F.CardFinder.load()
    synth = Synth(args.art, args.tex, args.size, seed=424242, art_ids=art_ids("train"))
    X, y = [], []
    for _ in range(args.n):
        img, _ = synth.sample()
        x0, y0, w, h = synth.last_box
        img = img[y0:y0 + h, x0:x0 + w]
        quad = None if synth.last_quad is None else synth.last_quad - [x0, y0]
        f = model.find(img)
        if f is None or "corner_cut_off" in f.reject_reasons or not in_frame(f.corners, img.shape):
            continue
        X.append([f.features[k] for k in F.FEATURES])
        y.append(float(quad is not None and polygon_iou(f.corners, quad) >= 0.85))
    X, y = np.array(X), np.array(y)
    mu, sd = X.mean(0), X.std(0) + 1e-6
    Z = (X - mu) / sd
    w, b = np.zeros(Z.shape[1]), 0.0
    for _ in range(4000):  # plain gradient descent, L2 1e-3
        p = 1 / (1 + np.exp(-(Z @ w + b)))
        w -= 0.1 * (Z.T @ (p - y) / len(y) + 1e-3 * w)
        b -= 0.1 * float((p - y).mean())
    weights = w / sd
    bias = b - float((w * mu / sd).sum())
    out = {"weights": dict(zip(F.FEATURES, map(float, weights))), "bias": float(bias),
           "fit_samples": int(len(y)), "positives": int(y.sum()),
           "split": f"synthetic, train-split art, seed 424242, {args.size}px"}
    (HERE.parent / "models" / "card-finder.confidence.json").write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
