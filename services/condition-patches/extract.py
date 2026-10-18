"""Cut corner and edge patches from a canonical 1500x2100 card warp for labeling."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import cv2
import numpy as np

CANONICAL = (1500, 2100)
CORNER = 192
EDGE_LONG, EDGE_SHORT = 384, 128
LABELS = ("clean", "whitening_light", "whitening_heavy", "ding", "bend", "crease", "scratch", "not_assessable")


def patches(warp: np.ndarray) -> dict[str, np.ndarray]:
    if (warp.shape[1], warp.shape[0]) != CANONICAL:
        warp = cv2.resize(warp, CANONICAL, interpolation=cv2.INTER_AREA)
    h, w = warp.shape[:2]
    c = CORNER
    out = {
        "corner_tl": warp[:c, :c],
        "corner_tr": warp[:c, w - c:],
        "corner_br": warp[h - c:, w - c:],
        "corner_bl": warp[h - c:, :c],
    }
    for i, x in enumerate((w // 3 - EDGE_LONG // 2, 2 * w // 3 - EDGE_LONG // 2)):
        out[f"edge_top_{i}"] = warp[:EDGE_SHORT, x:x + EDGE_LONG]
        out[f"edge_bottom_{i}"] = np.rot90(warp[h - EDGE_SHORT:, x:x + EDGE_LONG], 2)
    for i, y in enumerate((h // 3 - EDGE_LONG // 2, 2 * h // 3 - EDGE_LONG // 2)):
        out[f"edge_left_{i}"] = np.rot90(warp[y:y + EDGE_LONG, :EDGE_SHORT], -1)
        out[f"edge_right_{i}"] = np.rot90(warp[y:y + EDGE_LONG, w - EDGE_SHORT:], 1)
    return {k: np.ascontiguousarray(v) for k, v in out.items()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("warp", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--id", required=True)
    args = ap.parse_args()
    warp = cv2.imread(str(args.warp))
    if warp is None:
        raise SystemExit(f"cannot read {args.warp}")
    args.out.mkdir(parents=True, exist_ok=True)
    labels = args.out / "labels.csv"
    new = not labels.exists()
    with labels.open("a", newline="") as fh:
        writer = csv.writer(fh)
        if new:
            writer.writerow(["patch", "source_id", "position", "label", "labeler"])
        for name, patch in patches(warp).items():
            path = args.out / f"{args.id}_{name}.png"
            cv2.imwrite(str(path), patch)
            writer.writerow([path.name, args.id, name, "", ""])


if __name__ == "__main__":
    main()
