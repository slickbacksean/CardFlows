#!/usr/bin/env python3
"""Export gitignored YOLO26n to CoreML + LiteRT/TFLite for pre-ship on-device detect.

Ultralytics stays in a local venv — never vendored into apps/ or packages/.
Requires CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true.

TODO(ship): Replace YOLO26n (Ultralytics AGPL-3.0) or buy an Ultralytics
Enterprise license before App Store / production ship.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

MODULE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WORKDIR = MODULE_ROOT / ".yolo26n-export"
DEFAULT_OUT = MODULE_ROOT.parents[1] / "models"


def require_agpl() -> None:
    if os.environ.get("CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED", "").strip().lower() != "true":
        print(
            "Accept Ultralytics AGPL (CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true) "
            "before exporting YOLO26n weights.",
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
            f"  {venv}/bin/pip install -U ultralytics coremltools onnx\n"
            f"  CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true {venv}/bin/python {Path(__file__).resolve()}",
            file=sys.stderr,
        )
        raise SystemExit(1)


def file_size(path: Path) -> int | None:
    if path.is_file():
        return path.stat().st_size
    if path.is_dir():
        return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())
    return None


def export_one(model, fmt: str, imgsz: int, nms: bool) -> Path | None:
    from ultralytics import YOLO

    kwargs = {"format": fmt, "imgsz": imgsz}
    if fmt == "coreml":
        kwargs["nms"] = nms
    try:
        exported = Path(model.export(**kwargs))
    except TypeError:
        kwargs.pop("nms", None)
        try:
            exported = Path(model.export(**kwargs))
        except Exception as exc:
            print(f"export {fmt} failed: {exc}", file=sys.stderr)
            return None
    except Exception as exc:
        print(f"export {fmt} failed: {exc}", file=sys.stderr)
        return None
    return exported if exported.exists() else None


def copy_export(src: Path | None, dest: Path) -> Path | None:
    if src is None:
        return None
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        if dest.is_dir():
            shutil.rmtree(dest)
        else:
            dest.unlink()
    if src.is_dir():
        shutil.copytree(src, dest)
    else:
        shutil.copy2(src, dest)
    return dest


def time_predict(weights: Path, image: Path, imgsz: int, warmup: int, runs: int) -> dict:
    from ultralytics import YOLO

    model = YOLO(str(weights))
    for _ in range(warmup):
        model.predict(str(image), imgsz=imgsz, verbose=False)
    started = time.perf_counter()
    for _ in range(runs):
        model.predict(str(image), imgsz=imgsz, verbose=False)
    elapsed_ms = (time.perf_counter() - started) * 1000 / runs
    return {
        "weights": str(weights),
        "image": str(image),
        "imgsz": imgsz,
        "warmup": warmup,
        "runs": runs,
        "meanLatencyMs": round(elapsed_ms, 2),
    }


def write_probe_image(path: Path) -> None:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (640, 480), (36, 40, 48))
    draw = ImageDraw.Draw(image)
    draw.rectangle([180, 70, 380, 350], fill=(240, 230, 180), outline=(30, 30, 30), width=4)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, quality=90)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workdir", type=Path, default=DEFAULT_WORKDIR)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--model", default="yolo26n.pt")
    parser.add_argument("--skip-coreml", action="store_true")
    parser.add_argument("--skip-litert", action="store_true")
    parser.add_argument("--benchmark", action="store_true")
    parser.add_argument("--obb-compare", action="store_true")
    args = parser.parse_args()
    require_agpl()
    require_ultralytics()
    from ultralytics import YOLO

    args.workdir.mkdir(parents=True, exist_ok=True)
    os.chdir(args.workdir)
    model = YOLO(args.model)
    report: dict = {
        "model": args.model,
        "imgsz": args.imgsz,
        "ultralytics": getattr(__import__("ultralytics"), "__version__", "unknown"),
        "exports": {},
        "benchmarks": {},
        "notes": [
            "Weights are gitignored. Do not commit .pt / .tflite / .mlpackage.",
            "TODO(ship): replace YOLO26n or buy Ultralytics Enterprise before ship.",
        ],
    }

    if not args.skip_coreml:
        coreml = export_one(model, "coreml", args.imgsz, nms=True)
        dest = copy_export(coreml, args.out / "yolo26n-card.mlpackage")
        report["exports"]["coreml"] = {
            "ok": dest is not None,
            "path": str(dest) if dest else None,
            "bytes": file_size(dest) if dest else None,
        }

    if not args.skip_litert:
        litert = export_one(model, "litert", args.imgsz, nms=False)
        if litert is None:
            litert = export_one(model, "tflite", args.imgsz, nms=False)
        dest = copy_export(litert, args.out / "yolo26n-card.tflite")
        report["exports"]["litert"] = {
            "ok": dest is not None,
            "path": str(dest) if dest else None,
            "bytes": file_size(dest) if dest else None,
        }

    pt_size = file_size(Path(args.model))
    if pt_size is None:
        cached = args.workdir / args.model
        pt_size = file_size(cached)
    report["exports"]["pytorch"] = {"ok": pt_size is not None, "bytes": pt_size}

    if args.benchmark:
        probe = args.workdir / "latency-probe.jpg"
        write_probe_image(probe)
        try:
            report["benchmarks"]["yolo26n_pt"] = time_predict(
                Path(args.model) if Path(args.model).exists() else args.workdir / args.model,
                probe,
                args.imgsz,
                warmup=2,
                runs=5,
            )
        except Exception as exc:
            report["benchmarks"]["yolo26n_pt"] = {"error": str(exc)}

    if args.obb_compare:
        report["obbCompare"] = compare_obb(args.imgsz)

    out_json = args.out / "yolo26n-export-report.json"
    args.out.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


def compare_obb(imgsz: int) -> dict:
    """Compare YOLO26n-OBB vs YOLO11n-OBB on Ultralytics' tiny DOTA8 sample.

    This is a rotated-box probe on the official dota8 set — not TCG cards and
    not a substitute for a real stream/phone eval set.
    """
    from ultralytics import YOLO

    result: dict = {"dataset": "dota8.yaml", "imgsz": imgsz, "models": {}}
    for name in ("yolo11n-obb.pt", "yolo26n-obb.pt"):
        try:
            metrics = YOLO(name).val(data="dota8.yaml", imgsz=imgsz, verbose=False)
            box = getattr(metrics, "box", None)
            result["models"][name] = {
                "map50": getattr(box, "map50", None),
                "map": getattr(box, "map", None),
            }
        except Exception as exc:
            result["models"][name] = {"error": str(exc)}
    return result


if __name__ == "__main__":
    main()
