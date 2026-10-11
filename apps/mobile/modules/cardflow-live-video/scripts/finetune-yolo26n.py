#!/usr/bin/env python3
"""Fine-tune YOLO26n on a real livestream / phone-frame dataset.

refuses synthetic card images. The 72-image generator in
apps/api/scripts/export-yolo11n-obb.py is not a training source here.
Pass --data pointing at an existing YOLO detect dataset (see
docs/YOLO26N_ONDEVICE.md). This script never writes fake frames.

Ultralytics stays in a local venv — never vendored into apps/ or packages/.
Requires CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true.

TODO(ship): Replace YOLO26n (Ultralytics AGPL-3.0) or buy an Ultralytics
Enterprise license before App Store / production ship.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

MODULE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WORKDIR = MODULE_ROOT / ".yolo26n-train"
BANNED_DIR_NAMES = {".obb-train", "synthetic", "fake-cards"}


def require_agpl() -> None:
    if os.environ.get("CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED", "").strip().lower() != "true":
        print(
            "Accept Ultralytics AGPL (CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true) "
            "before fine-tuning YOLO26n.",
            file=sys.stderr,
        )
        raise SystemExit(2)


def require_ultralytics() -> None:
    try:
        import ultralytics  # noqa: F401
    except ImportError:
        venv = DEFAULT_WORKDIR / "venv"
        print(
            "Install Ultralytics in a gitignored venv (do not add it to apps/):\n"
            f"  python3 -m venv {venv}\n"
            f"  {venv}/bin/pip install -U ultralytics\n"
            f"  CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true {venv}/bin/python {Path(__file__).resolve()} "
            "--data /path/to/real/data.yaml",
            file=sys.stderr,
        )
        raise SystemExit(1)


def resolve_data_yaml(data: Path) -> Path:
    if data.is_dir():
        yaml_path = data / "data.yaml"
    else:
        yaml_path = data
    if not yaml_path.is_file():
        raise SystemExit(
            f"missing dataset yaml: {yaml_path}\n"
            "Collect real stream/phone frames first. This script refuses synthetic "
            "generation. See docs/YOLO26N_ONDEVICE.md."
        )
    return yaml_path.resolve()


def dataset_root(yaml_path: Path) -> Path:
    path_line = None
    for raw in yaml_path.read_text().splitlines():
        if raw.startswith("path:"):
            path_line = raw.split(":", 1)[1].strip()
            break
    root = Path(path_line) if path_line else yaml_path.parent
    if not root.is_absolute():
        root = (yaml_path.parent / root).resolve()
    return root


def validate_real_dataset(yaml_path: Path) -> tuple[Path, int]:
    root = dataset_root(yaml_path)
    for part in root.parts:
        if part in BANNED_DIR_NAMES:
            raise SystemExit(
                f"refuses synthetic / generated dataset path: {root}\n"
                "Point --data at real livestream or phone frames."
            )
    if (root / "SYNTHETIC").exists() or (root / "GENERATED_BY_EXPORT_YOLO11N_OBB").exists():
        raise SystemExit("refuses synthetic dataset marker file")
    images = []
    for split in ("train", "val"):
        split_dir = root / split / "images"
        if not split_dir.is_dir():
            raise SystemExit(f"missing {split} images: {split_dir}")
        found = [
            path
            for path in split_dir.iterdir()
            if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
        ]
        if not found:
            raise SystemExit(f"no real frames in {split_dir}")
        labels = root / split / "labels"
        labeled = 0
        for image in found:
            if (labels / f"{image.stem}.txt").is_file():
                labeled += 1
        if labeled == 0:
            raise SystemExit(f"no YOLO labels next to {split} images")
        images.extend(found)
    return root, len(images)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data",
        type=Path,
        required=True,
        help="Existing YOLO detect data.yaml (or directory containing it). Must already have real frames.",
    )
    parser.add_argument("--workdir", type=Path, default=DEFAULT_WORKDIR)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--model", default="yolo26n.pt")
    args = parser.parse_args()
    require_agpl()
    require_ultralytics()
    yaml_path = resolve_data_yaml(args.data)
    root, count = validate_real_dataset(yaml_path)
    print(f"dataset root={root} frames={count}")

    from ultralytics import YOLO

    args.workdir.mkdir(parents=True, exist_ok=True)
    os.chdir(args.workdir)
    model = YOLO(args.model)
    model.train(
        data=str(yaml_path),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=4,
        device="cpu",
        workers=0,
        project=str(args.workdir / "runs"),
        name="cardflow-yolo26n",
        exist_ok=True,
        pretrained=True,
        plots=False,
    )
    best = Path(model.trainer.best)
    print(f"best={best}")
    print("Re-export with export-yolo26n-ondevice.py --model", best)


if __name__ == "__main__":
    main()
