#!/usr/bin/env python3
"""CardFlow-owned adapter: run vendored detect_and_normalize and print JSON.

This file is not part of https://github.com/stolemynikes/cardgrading.
It exists so the Node API can find and crop a card before grade_card runs.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

VENDOR_ROOT = Path(__file__).resolve().parent


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Detect and crop a card for CardFlow.")
    parser.add_argument("--photo", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--thresholds",
        type=Path,
        default=VENDOR_ROOT / "calibration" / "thresholds.json",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    sys.path.insert(0, str(VENDOR_ROOT))

    import cv2
    from pipeline import detect

    image = cv2.imread(str(args.photo))
    if image is None:
        json.dump(
            {
                "ok": False,
                "has_crop": False,
                "gates": [
                    {
                        "name": "card_detection",
                        "passed": False,
                        "detail": "could not decode image",
                        "value": None,
                        "hard": True,
                    }
                ],
            },
            sys.stdout,
        )
        sys.stdout.write("\n")
        return 0

    thresholds = detect.load_thresholds(args.thresholds)
    result = detect.detect_and_normalize(image, thresholds)
    payload = result.to_dict()
    payload["has_crop"] = result.warped is not None
    if result.warped is not None:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        crop_path = args.output_dir / "crop.jpg"
        cv2.imwrite(str(crop_path), result.warped, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
        payload["crop_path"] = str(crop_path)

    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
