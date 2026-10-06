#!/usr/bin/env python3
"""Train/export gitignored yolo11n-obb.onnx for physical TCG stills.

Ultralytics stays in a local venv — never vendored into apps/ or packages/.
Does not import TCG Pocket weights, JSON, or sprites.
"""

from __future__ import annotations

import argparse
import math
import os
import random
import shutil
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WORKDIR = API_ROOT / ".obb-train"
DEFAULT_OUT = API_ROOT / "models" / "yolo11n-obb.onnx"
CARD_ASPECT = 63 / 88  # English physical TCG, not Pocket.


def require_ultralytics() -> None:
    try:
        import ultralytics  # noqa: F401
        from PIL import Image  # noqa: F401
    except ImportError:
        venv = DEFAULT_WORKDIR / "venv"
        print(
            "Install Ultralytics in a gitignored venv (do not add it to apps/):\n"
            f"  python3 -m venv {venv}\n"
            f"  {venv}/bin/pip install torch==2.2.2 torchvision==0.17.2 numpy==1.26.4 "
            "opencv-python==4.10.0.84 'ultralytics==8.3.40' pillow onnx onnxruntime\n"
            f"  {venv}/bin/python {Path(__file__).resolve()}",
            file=sys.stderr,
        )
        raise SystemExit(1)


def make_physical_card(rng: random.Random, width: int, height: int):
    from PIL import Image, ImageDraw

    card = Image.new("RGB", (width, height), (248, 246, 240))
    draw = ImageDraw.Draw(card)
    kind = rng.choice(["pokemon", "trainer", "energy"])
    outer = {"pokemon": (238, 210, 42), "trainer": (168, 172, 180), "energy": (56, 148, 88)}[kind]
    inset = max(2, width // 28)
    draw.rectangle([0, 0, width - 1, height - 1], outline=outer, width=inset)
    inner = inset * 2
    art = [inner, inner + height // 16, width - inner, int(height * 0.58)]
    draw.rectangle(art, fill=(rng.randint(20, 80), rng.randint(40, 140), rng.randint(30, 200)))
    for _ in range(rng.randint(3, 8)):
        x0 = rng.randint(art[0], art[2] - 4)
        y0 = rng.randint(art[1], art[3] - 4)
        x1 = min(art[2], x0 + rng.randint(8, width // 3))
        y1 = min(art[3], y0 + rng.randint(8, height // 4))
        draw.ellipse(
            [x0, y0, x1, y1],
            fill=(rng.randint(0, 255), rng.randint(0, 255), rng.randint(0, 255)),
        )
    if rng.random() < 0.4:
        for i in range(0, width + height, 7):
            draw.line([(i, art[1]), (i - height // 2, art[3])], fill=(220, 230, 255), width=1)
    name_top = art[3] + 2
    draw.rectangle([inner, name_top, width - inner, name_top + height // 12], fill=(32, 32, 36))
    draw.rectangle(
        [inner, int(height * 0.72), width - inner, height - inner],
        fill=(rng.randint(220, 250), rng.randint(220, 250), rng.randint(210, 240)),
    )
    return card


def make_backdrop(rng: random.Random, width: int, height: int):
    from PIL import Image, ImageDraw, ImageFilter

    kind = rng.choice(["table", "scanner", "hand"])
    if kind == "table":
        base = (rng.randint(78, 110), rng.randint(48, 72), rng.randint(22, 40))
        image = Image.new("RGB", (width, height), base)
        draw = ImageDraw.Draw(image)
        for y in range(0, height, rng.randint(3, 7)):
            tone = tuple(max(0, min(255, c + rng.randint(-18, 18))) for c in base)
            draw.line([(0, y), (width, y)], fill=tone, width=rng.randint(1, 3))
        for _ in range(12):
            x0, y0 = rng.randint(0, width), rng.randint(0, height)
            draw.ellipse([x0, y0, x0 + rng.randint(8, 40), y0 + rng.randint(8, 28)], fill=(40, 28, 16))
    elif kind == "scanner":
        image = Image.new("RGB", (width, height), (rng.randint(150, 175),) * 3)
        draw = ImageDraw.Draw(image)
        draw.rectangle(
            [width // 10, height // 10, width * 9 // 10, height * 9 // 10],
            outline=(90, 90, 95),
            width=3,
        )
        pixels = image.load()
        for _ in range(40):
            x, y = rng.randint(0, width - 1), rng.randint(0, height - 1)
            pixels[x, y] = (rng.randint(80, 200),) * 3
    else:
        image = Image.new("RGB", (width, height), (rng.randint(30, 60), rng.randint(80, 120), rng.randint(40, 70)))
        draw = ImageDraw.Draw(image)
        skin = (rng.randint(190, 230), rng.randint(140, 180), rng.randint(110, 150))
        draw.ellipse([width // 5, height // 3, width * 4 // 5, height], fill=skin)
        for i in range(4):
            x = width // 4 + i * width // 7
            draw.ellipse([x, height // 8, x + width // 10, height // 2], fill=skin)
    if rng.random() < 0.5:
        image = image.filter(ImageFilter.GaussianBlur(radius=rng.random() * 1.2))
    return image


def rotate_corners(cx: float, cy: float, width: float, height: float, angle_rad: float):
    cos_a, sin_a = math.cos(angle_rad), math.sin(angle_rad)
    hw, hh = width / 2, height / 2
    local = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
    return [(cx + x * cos_a - y * sin_a, cy + x * sin_a + y * cos_a) for x, y in local]


def overlay_card(backdrop, card, cx: float, cy: float, angle_deg: float):
    from PIL import Image

    overlay = Image.new("RGBA", backdrop.size, (0, 0, 0, 0))
    overlay.paste(
        card.convert("RGBA"),
        (int(round(cx - card.width / 2)), int(round(cy - card.height / 2))),
    )
    rotated = overlay.rotate(angle_deg, resample=Image.Resampling.BICUBIC, center=(cx, cy))
    return Image.alpha_composite(backdrop.convert("RGBA"), rotated).convert("RGB")


def write_label(path: Path, corners: list[tuple[float, float]], width: int, height: int) -> None:
    coords = []
    for x, y in corners:
        coords.append(f"{x / width:.6f}")
        coords.append(f"{y / height:.6f}")
    path.write_text("0 " + " ".join(coords) + "\n")


def synthesize_split(split_dir: Path, count: int, rng: random.Random) -> None:
    images = split_dir / "images"
    labels = split_dir / "labels"
    images.mkdir(parents=True, exist_ok=True)
    labels.mkdir(parents=True, exist_ok=True)
    for i in range(count):
        canvas_w, canvas_h = rng.choice([(640, 640), (640, 480), (480, 640)])
        backdrop = make_backdrop(rng, canvas_w, canvas_h)
        long_side = rng.randint(int(min(canvas_w, canvas_h) * 0.28), int(min(canvas_w, canvas_h) * 0.62))
        card_h = long_side
        card_w = max(24, int(card_h * CARD_ASPECT))
        card = make_physical_card(rng, card_w, card_h)
        placed = False
        for _ in range(30):
            angle = rng.uniform(-55, 55)
            rad = math.radians(angle)
            cx = rng.uniform(card_w * 0.55, canvas_w - card_w * 0.55)
            cy = rng.uniform(card_h * 0.55, canvas_h - card_h * 0.55)
            corners = rotate_corners(cx, cy, card_w, card_h, rad)
            if all(2 <= x <= canvas_w - 2 and 2 <= y <= canvas_h - 2 for x, y in corners):
                still = overlay_card(backdrop, card, cx, cy, angle)
                write_label(labels / f"{i:04d}.txt", corners, canvas_w, canvas_h)
                still.save(images / f"{i:04d}.jpg", quality=rng.randint(72, 95))
                placed = True
                break
        if not placed:
            cx, cy = canvas_w / 2, canvas_h / 2
            still = overlay_card(backdrop, card, cx, cy, 0)
            write_label(
                labels / f"{i:04d}.txt",
                rotate_corners(cx, cy, card_w, card_h, 0),
                canvas_w,
                canvas_h,
            )
            still.save(images / f"{i:04d}.jpg", quality=88)


def write_data_yaml(dataset: Path) -> Path:
    yaml_path = dataset / "data.yaml"
    yaml_path.write_text(
        "\n".join(
            [
                f"path: {dataset}",
                "train: train/images",
                "val: val/images",
                "nc: 1",
                "names: [card]",
                "",
            ]
        )
    )
    return yaml_path


def write_messy_probe(path: Path, rng: random.Random) -> None:
    canvas_w, canvas_h = 640, 480
    backdrop = make_backdrop(rng, canvas_w, canvas_h)
    card_h, card_w = 280, int(280 * CARD_ASPECT)
    card = make_physical_card(rng, card_w, card_h)
    still = overlay_card(backdrop, card, 250, 270, -18)
    path.parent.mkdir(parents=True, exist_ok=True)
    still.save(path, quality=90)


def train_and_export(workdir: Path, out: Path, epochs: int, imgsz: int) -> Path:
    from ultralytics import YOLO

    os.chdir(workdir)
    dataset = workdir / "dataset"
    synthesize_split(dataset / "train", 72, random.Random(7))
    synthesize_split(dataset / "val", 16, random.Random(11))
    data_yaml = write_data_yaml(dataset)
    probe = workdir / "messy-still.jpg"
    write_messy_probe(probe, random.Random(21))

    model = YOLO("yolo11n-obb.pt")
    model.train(
        data=str(data_yaml),
        epochs=epochs,
        imgsz=imgsz,
        batch=4,
        device="cpu",
        workers=0,
        project=str(workdir / "runs"),
        name="cardflow-obb",
        exist_ok=True,
        patience=8,
        plots=False,
        cache=False,
        amp=False,
        pretrained=True,
        mosaic=0.15,
        close_mosaic=2,
    )
    best = Path(model.trainer.best)
    exporter = YOLO(str(best))
    try:
        exported = Path(exporter.export(format="onnx", imgsz=imgsz, nms=False, simplify=True, opset=12))
    except Exception:
        exported = Path(exporter.export(format="onnx", imgsz=imgsz, nms=False, simplify=False, opset=12))
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(exported, out)
    return probe


def probe_crop(onnx_path: Path, image_path: Path, imgsz: int, pt_path: Path | None = None) -> None:
    from PIL import Image
    from ultralytics import YOLO

    image = Image.open(image_path)
    full = image.width * image.height
    try:
        results = YOLO(str(onnx_path), task="obb")(str(image_path), imgsz=imgsz, verbose=False)
    except ModuleNotFoundError:
        if pt_path is None or not pt_path.exists():
            raise
        print("onnxruntime missing; probing with best.pt")
        results = YOLO(str(pt_path), task="obb")(str(image_path), imgsz=imgsz, verbose=False)
    boxes = results[0].obb
    if boxes is None or len(boxes) == 0:
        raise SystemExit(f"probe failed: no OBB on {image_path}")
    box = boxes.xywhr.cpu().numpy()[0]
    area = float(box[2] * box[3])
    print(
        f"probe full={image.width}x{image.height} box={box[2]:.1f}x{box[3]:.1f} "
        f"area_ratio={area / full:.3f}"
    )
    if area >= full * 0.92:
        raise SystemExit("probe failed: crop is not tighter than the full still")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workdir", type=Path, default=DEFAULT_WORKDIR)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--imgsz", type=int, default=640)
    args = parser.parse_args()
    require_ultralytics()
    args.workdir.mkdir(parents=True, exist_ok=True)
    probe = train_and_export(args.workdir, args.out, args.epochs, args.imgsz)
    best_pt = args.workdir / "runs" / "cardflow-obb" / "weights" / "best.pt"
    probe_crop(args.out, probe, args.imgsz, best_pt)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
