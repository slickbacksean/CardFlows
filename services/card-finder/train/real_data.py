"""Build real-photo manifests for fine-tuning (see DATASETS.md).

    python3 train/real_data.py --ext /workspace/cf/ext --out /workspace/cf/real

antokun/pokemon-card-segmentation (CC0): YOLO-seg polygons -> 4 corners (a 5-point
polygon with a repeated point is collapsed; anything else is skipped).
stevelohwc/... (MIT): counterfeits dropped; authentic photos get PSEUDO-LABELS from
the current finder (edge-snapped), kept only if confident, convex, 63:88 after
rectification and well inside the frame. Pseudo-labels then pass a manual visual
review (review sheet written next to the manifest); rejects go in rejected.txt.
Split: 80/20 train/val by a hash of the file name (fixed).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))


def split_of(name: str) -> str:
    return "val" if int(hashlib.sha1(name.encode()).hexdigest(), 16) % 5 == 0 else "train"


def antokun(root: Path) -> list[dict]:
    rows = []
    for lab in sorted((root / "labels" / "train").glob("*.txt")):
        img = root / "images" / "train" / (lab.stem + ".jpg")
        lines = [l.split() for l in lab.read_text().splitlines() if l.strip()]
        if len(lines) != 1 or not img.exists():
            continue
        pts = np.array(lines[0][1:], float).reshape(-1, 2)
        uniq = [p for i, p in enumerate(pts) if not any(np.allclose(p, q, atol=1e-4) for q in pts[:i])]
        if len(uniq) != 4:
            continue
        h, w = cv2.imread(str(img), cv2.IMREAD_REDUCED_GRAYSCALE_8).shape[:2]
        h, w = h * 8, w * 8
        corners = (np.array(uniq) * [w, h]).round(1).tolist()
        rows.append({"image": str(img), "corners": corners, "split": split_of(img.name),
                     "source": "antokun/pokemon-card-segmentation", "license": "CC0-1.0",
                     "label_method": "dataset polygon (author-labelled)"})
    return rows


def steve(root: Path, review: Path) -> tuple[list[dict], list[dict]]:
    import finder as F
    from pipeline.plane import estimate_plane_pose

    model = F.CardFinder.load()
    keep, drop = [], []
    for r in csv.DictReader(open(root / "labels.csv")):
        if r["labels"] != "1":  # 1 = authentic, 0 = counterfeit (dropped)
            continue
        path = root / "Images" / r["id"]
        img = cv2.imread(str(path))
        if img is None:
            continue
        f = model.find(img)
        row = {"image": str(path), "split": split_of(r["id"]), "side": "back" if r["side"] == "1" else "front",
               "source": "stevelohwc/pokemon_card_image_for_authenticity_classification", "license": "MIT",
               "label_method": "pseudo-label: card-finder v0.2.1 + edge snapping, manually reviewed"}
        ok = f is not None and f.confidence >= 0.5 and not f.reject_reasons
        if ok:
            ar = abs(estimate_plane_pose(f.corners, img.shape).rectified_aspect / (63 / 88) - 1)
            ok = ar < 0.03
        if f is not None:
            row["corners"] = np.round(f.corners, 1).tolist()
            row["confidence"] = round(f.confidence, 3)
        (keep if ok else drop).append(row)
    review.mkdir(parents=True, exist_ok=True)
    for i in range(0, len(keep), 12):
        tiles = []
        for row in keep[i:i + 12]:
            im = cv2.imread(row["image"])
            cv2.polylines(im, [np.array(row["corners"], np.int32)], True, (0, 255, 0), 12)
            tiles.append(cv2.resize(im, (300, 400) if im.shape[0] > im.shape[1] else (400, 300))[:300, :300])
            cv2.putText(tiles[-1], Path(row["image"]).stem, (5, 25), 0, 0.8, (0, 0, 255), 2)
        while len(tiles) < 12:
            tiles.append(np.zeros((300, 300, 3), np.uint8))
        cv2.imwrite(str(review / f"steve_{i // 12:02d}.jpg"), np.vstack([np.hstack(tiles[j:j + 4]) for j in (0, 4, 8)]))
    return keep, drop


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ext", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    a = antokun(args.ext / "pokemon-card-segmentation")
    s, dropped = steve(args.ext / "pokemon_card_image_for_authenticity_classification", args.out / "review")
    exclude = [l.split("\t")[0] for l in (HERE / "real-exclude.txt").read_text().splitlines() if l and not l.startswith("#")]
    a = [r for r in a if not any(r["image"].endswith(e) for e in exclude)]
    s = [r for r in s if not any(r["image"].endswith(e) for e in exclude)]
    for name, rows in (("antokun", a), ("steve", s), ("steve-dropped", dropped)):
        (args.out / f"{name}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
        print(name, len(rows), {k: sum(r["split"] == k for r in rows) for k in ("train", "val")})


if __name__ == "__main__":
    main()
