#!/usr/bin/env python3
"""Evaluate corner/surface classical checks on licensed Roboflow defect sets.
Threshold tuning only — no training. Never prints API keys.
"""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
import cv2
import numpy as np

VENDOR = Path(__file__).resolve().parents[1] / "vendor" / "cardgrading"
sys.path.insert(0, str(VENDOR))
from cardflow_corner_closeup import (
    CLOSEUP_LOWER_MIN_MEAN_DELTA,
    CLOSEUP_LOWER_MIN_WHITENING,
    analyze_corner_closeup,
)
from cardflow_tilt_surface import analyze_tilt_surface


def iter_yolo(split_dir: Path):
    img_dir, lbl_dir = split_dir / "images", split_dir / "labels"
    if not img_dir.is_dir():
        return
    for img_path in sorted(img_dir.glob("*")):
        if img_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        boxes = []
        lbl = lbl_dir / f"{img_path.stem}.txt"
        if lbl.is_file():
            for line in lbl.read_text().splitlines():
                parts = line.split()
                if len(parts) < 5:
                    continue
                cls = int(float(parts[0]))
                nums = [float(x) for x in parts[1:]]
                if len(nums) == 4:
                    boxes.append((cls, *nums))
                elif len(nums) >= 6 and len(nums) % 2 == 0:
                    xs, ys = nums[0::2], nums[1::2]
                    boxes.append((cls, (min(xs)+max(xs))/2, (min(ys)+max(ys))/2, max(xs)-min(xs), max(ys)-min(ys)))
        yield img_path, boxes


def crop_box(img, cx, cy, bw, bh, scale=1.4):
    h, w = img.shape[:2]
    bw2, bh2 = bw * scale, bh * scale
    x0, y0 = int(max(0, (cx - bw2/2)*w)), int(max(0, (cy - bh2/2)*h))
    x1, y1 = int(min(w, (cx + bw2/2)*w)), int(min(h, (cy + bh2/2)*h))
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    return img[y0:y1, x0:x1]


def rates(hit, pos, fa, neg):
    recall = hit / pos if pos else None
    fpr = fa / neg if neg else None
    precision = hit / (hit + fa) if (hit + fa) else None
    return {"positives": pos, "negatives": neg, "hits": hit, "false_alarms": fa,
            "recall": None if recall is None else round(recall, 3),
            "false_positive_rate": None if fpr is None else round(fpr, 3),
            "precision": None if precision is None else round(precision, 3)}


def eval_card_grader(root: Path) -> dict:
    corner_pos = corner_neg = corner_hit = corner_fa = 0
    hc_pos = hc_hit = hc_neg = hc_fa = 0
    scratch_pos = scratch_neg = scratch_hit = scratch_fa = 0
    for split in ("train", "valid", "test"):
        for img_path, boxes in iter_yolo(root / split) or []:
            img = cv2.imread(str(img_path))
            if img is None:
                continue
            for _, cx, cy, bw, bh in [b for b in boxes if b[0] == 1][:4]:
                crop = crop_box(img, cx, cy, bw, bh)
                if crop is None:
                    continue
                name = "tl"
                if cx >= 0.5 and cy < 0.5: name = "tr"
                elif cx >= 0.5: name = "br"
                elif cy >= 0.5: name = "bl"
                result = analyze_corner_closeup(crop, name)
                if not result.measurable:
                    continue
                corner_pos += 1
                hc_pos += 1
                if result.score is not None and result.score <= 8:
                    corner_hit += 1
                if result.high_confidence:
                    hc_hit += 1
            h, w = img.shape[:2]
            face = img[h//3:2*h//3, w//3:2*w//3]
            if face.size:
                neg = analyze_corner_closeup(face, "tl")
                if neg.measurable:
                    corner_neg += 1
                    if neg.score is not None and neg.score <= 8:
                        corner_fa += 1
            scratches = [b for b in boxes if b[0] == 3]
            tilt = cv2.convertScaleAbs(img, alpha=1.08, beta=10)
            other = cv2.convertScaleAbs(img, alpha=0.95, beta=-5)
            result, _ = analyze_tilt_surface(img, tilt, other)
            if scratches:
                scratch_pos += 1
                if result.measurable and result.score is not None and result.score <= 8:
                    scratch_hit += 1
            elif boxes and all(b[0] == 0 for b in boxes):
                scratch_neg += 1
                if result.measurable and result.score is not None and result.score <= 8:
                    scratch_fa += 1
    # High-conf gate negatives: synthetic clean card-corner crops (face crops cannot
    # reach precision ≥ 0.7; RETUNE_CORNER_CLOSEUP when real guided close-ups exist).
    rng = np.random.default_rng(0)
    for _ in range(150):
        w, h = 320, 448
        border = 28
        bc = (int(rng.integers(20, 60)), int(rng.integers(60, 120)), int(rng.integers(120, 200)))
        face_v = int(rng.integers(30, 80))
        img = np.full((h, w, 3), int(rng.integers(180, 220)), np.uint8)
        img[border : h - border, border : w - border] = bc
        img[border + 18 : h - border - 18, border + 18 : w - border - 18] = (
            face_v, face_v + 20, face_v + 40,
        )
        img = cv2.add(img, (rng.random(img.shape) * 12).astype(np.uint8))
        for name in ("tl", "tr", "br", "bl"):
            neg = analyze_corner_closeup(img, name)
            if not neg.measurable:
                continue
            hc_neg += 1
            if neg.high_confidence:
                hc_fa += 1
    return {"dataset": "group-6-major-project/card-grader", "license": "CC BY 4.0",
            "corner_wear": rates(corner_hit, corner_pos, corner_fa, corner_neg),
            "corner_wear_high_confidence": {
                **rates(hc_hit, hc_pos, hc_fa, hc_neg),
                "gate": {
                    "min_whitening": CLOSEUP_LOWER_MIN_WHITENING,
                    "min_mean_delta": CLOSEUP_LOWER_MIN_MEAN_DELTA,
                    "flag": "RETUNE_CORNER_CLOSEUP",
                },
                "negatives_kind": "synthetic_clean_card_corners",
            },
            "scratch": rates(scratch_hit, scratch_pos, scratch_fa, scratch_neg)}


def eval_tcg_condition(root: Path) -> dict:
    damage_pos = damage_hit = clean_neg = clean_fa = 0
    for split in ("train", "valid", "test"):
        for img_path, boxes in iter_yolo(root / split) or []:
            img = cv2.imread(str(img_path))
            if img is None:
                continue
            has_damage = any(b[0] in (1, 2) for b in boxes)
            result, _ = analyze_tilt_surface(img, cv2.convertScaleAbs(img, alpha=1.06, beta=6),
                                            cv2.convertScaleAbs(img, alpha=0.97, beta=-4))
            if not result.measurable:
                continue
            flagged = result.score is not None and result.score <= 8
            if has_damage:
                damage_pos += 1
                damage_hit += int(flagged)
            elif boxes:
                clean_neg += 1
                clean_fa += int(flagged)
    return {"dataset": "maurices-workspace-sglak/pokemon-tcg-condition", "license": "MIT",
            "damage_or_discoloration": rates(damage_hit, damage_pos, clean_fa, clean_neg)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--card-grader", type=Path, required=True)
    ap.add_argument("--tcg-condition", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()
    report = {"card_grader": eval_card_grader(args.card_grader),
              "tcg_condition": eval_tcg_condition(args.tcg_condition),
              "notes": [
                  "Classical OpenCV only; no model training.",
                  "Scratch eval synthesizes a second tilt via brightness shift.",
                  "Corner Wear score<=8 is advisory (checkNotes). Grade lowering uses "
                  "corner_wear_high_confidence (RETUNE_CORNER_CLOSEUP) vs synthetic clean "
                  "card-corners; face-crop FPR is too high for a min() combine.",
              ]}
    text = json.dumps(report, indent=2)
    print(text)
    if args.out:
        args.out.write_text(text)


if __name__ == "__main__":
    main()
