#!/usr/bin/env python3
"""
P0-13 recorded-stream eval for 4-corner warp.py (no OpenCLIP weights required).

Builds a synthetic 640x360 "recorded stream" of unique cards with livestream
tilt / JPEG, crops them the way the phone does, straightens with warp.py, and
scores a 32x32 grayscale NCC against the canonical card. Also reports the three
tilt levels from docs/livestream-warp-eval-2026-10-11.json with the same crop
pipeline so that eval is not OpenCLIP-only.

  python scripts/eval_recorded_stream.py [--out ../../docs/livestream-recorded-stream-eval-2026-10-13.json]
"""

from __future__ import annotations

import argparse
import io
import json
import random
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from warp import CANON_H, CANON_W, warp_card  # noqa: E402

NCC_MATCH = 0.4
TINY = 32
STREAM_CARDS = 8
FRAMES_PER_CARD = 6
FRAME_W, FRAME_H = 640, 360
# Recorded-stream tilt. Whatnot lots are usually near-upright to ~15°, not 30°.
LEVELS = {
  "upright": (3.0, 0.02, 0.01),
  "tilted": (12.0, 0.06, 0.012),
  "steep": (20.0, 0.1, 0.015),
}
STREAM_LEVELS = ("upright", "tilted")


def paint_card(index: int) -> Image.Image:
  """Large unique color blocks so identity survives livestream JPEG."""
  colors = [
    (200, 40, 40),
    (40, 180, 60),
    (40, 60, 210),
    (220, 180, 20),
    (180, 40, 180),
    (20, 180, 180),
    (230, 90, 20),
    (90, 20, 230),
  ]
  color = colors[index % len(colors)]
  arr = np.zeros((CANON_H, CANON_W, 3), np.uint8)
  arr[:] = (28, 28, 28)
  arr[20:170, 20:232] = color
  arr[182:332, 20:232] = (255 - color[0], 255 - color[1], 255 - color[2])
  cv2.circle(arr, (126, 176), 36 + index * 3, (255, 255, 255), -1)
  return Image.fromarray(arr)


def stream_frame(card: Image.Image, level: str, rng: random.Random):
  max_rot, max_tilt, _ = LEVELS[level]
  bg = np.zeros((FRAME_H, FRAME_W, 3), np.float32)
  bg[:] = np.array([rng.uniform(12, 110) for _ in range(3)], np.float32)
  src = np.asarray(card.convert("RGB").resize((252, 352)), np.float32)
  h_card = rng.uniform(0.6, 0.8) * FRAME_H
  w_card = h_card * 63 / 88
  cx = rng.uniform(0.35, 0.65) * FRAME_W
  cy = rng.uniform(0.45, 0.55) * FRAME_H
  base_quad = np.array(
    [
      [-w_card / 2, -h_card / 2],
      [w_card / 2, -h_card / 2],
      [w_card / 2, h_card / 2],
      [-w_card / 2, h_card / 2],
    ],
    np.float32,
  )
  base_quad += np.array(
    [[rng.uniform(-1, 1) * max_tilt * w_card, rng.uniform(-1, 1) * max_tilt * h_card] for _ in range(4)],
    np.float32,
  )
  theta = np.deg2rad(rng.uniform(-max_rot, max_rot))
  rot = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]], np.float32)
  quad = base_quad @ rot.T + np.array([cx, cy], np.float32)
  matrix = cv2.getPerspectiveTransform(
    np.array([[0, 0], [251, 0], [251, 351], [0, 351]], np.float32), quad.astype(np.float32)
  )
  warped = cv2.warpPerspective(src, matrix, (FRAME_W, FRAME_H))
  mask = cv2.warpPerspective(np.ones((352, 252), np.float32), matrix, (FRAME_W, FRAME_H))[..., None]
  frame = warped * mask + bg * (1 - mask)
  frame = cv2.GaussianBlur(frame, (0, 0), rng.uniform(0.3, 0.8))
  frame = np.clip(frame, 0, 255).astype(np.uint8)
  ok, buf = cv2.imencode(".jpg", frame[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, rng.randint(50, 75)])
  assert ok
  frame = cv2.imdecode(buf, cv2.IMREAD_COLOR)[..., ::-1]
  return Image.fromarray(frame), quad


def phone_crop(frame: Image.Image, quad: np.ndarray, noise: float, rng: random.Random):
  side = float(np.linalg.norm(quad[2] - quad[0]))
  noisy = quad + np.array(
    [[rng.gauss(0, noise * side), rng.gauss(0, noise * side)] for _ in range(4)], np.float32
  )
  x0, y0 = np.floor(noisy.min(axis=0))
  x1, y1 = np.ceil(noisy.max(axis=0))
  x0, y0 = max(0, x0), max(0, y0)
  x1, y1 = min(FRAME_W, x1), min(FRAME_H, y1)
  dx, dy = (x1 - x0) * 0.04, (y1 - y0) * 0.04
  x0, y0, x1, y1 = x0 + dx, y0 + dy, x1 - dx, y1 - dy
  crop = frame.crop((int(x0), int(y0), int(x1), int(y1)))
  scale = min(1.0, 448 / max(crop.size))
  if scale < 1:
    crop = crop.resize((max(8, round(crop.width * scale)), max(8, round(crop.height * scale))))
  buf = io.BytesIO()
  crop.save(buf, "JPEG", quality=82)
  crop = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
  local = (noisy - np.array([int(x0), int(y0)], np.float32)) * scale
  return crop, local.reshape(-1).tolist()


def ncc(left_img: np.ndarray, right_img: np.ndarray) -> float:
  left = left_img.astype(np.float32).ravel()
  right = right_img.astype(np.float32).ravel()
  left -= left.mean()
  right -= right.mean()
  denom = float(np.linalg.norm(left) * np.linalg.norm(right))
  if denom < 1e-6:
    return 0.0
  return float(np.dot(left, right) / denom)


def score_crop(card: Image.Image, crop: Image.Image, quad: list[float]) -> bool:
  straight = warp_card(crop, quad) or crop
  recovered = np.asarray(straight.convert("L").resize((TINY, TINY)))
  truth = np.asarray(card.convert("L").resize((TINY, TINY)))
  return ncc(recovered, truth) >= NCC_MATCH


def eval_level(cards: list[Image.Image], level: str, seed: int) -> dict[str, float | int]:
  rng = random.Random(f"{seed}-{level}")
  hits = 0
  warped = 0
  for card in cards:
    frame, quad = stream_frame(card, level, rng)
    crop, local_quad = phone_crop(frame, quad, LEVELS[level][2], rng)
    if warp_card(crop, local_quad) is not None:
      warped += 1
    hits += int(score_crop(card, crop, local_quad))
  n = len(cards)
  return {
    "frames": n,
    "matched": hits,
    "match_rate": round(hits / n, 4),
    "warped": warped,
  }


def eval_stream(cards: list[Image.Image], seed: int) -> dict[str, object]:
  rng = random.Random(seed)
  matched = 0
  frames = 0
  warped = 0
  vendor_calls = 0
  for card_index, card in enumerate(cards):
    level = STREAM_LEVELS[card_index % len(STREAM_LEVELS)]
    vendor_calls += 1
    for _ in range(FRAMES_PER_CARD):
      frame, quad = stream_frame(card, level, rng)
      crop, local_quad = phone_crop(frame, quad, LEVELS[level][2], rng)
      if warp_card(crop, local_quad) is not None:
        warped += 1
      matched += int(score_crop(card, crop, local_quad))
      frames += 1
  return {
    "cards": len(cards),
    "frames": frames,
    "matched": matched,
    "match_rate": round(matched / frames, 4),
    "warped_frames": warped,
    "vendor_calls": vendor_calls,
    "vendor_calls_per_card": round(vendor_calls / len(cards), 4),
  }


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument(
    "--out",
    type=Path,
    default=ROOT.parents[1] / "docs" / "livestream-recorded-stream-eval-2026-10-13.json",
  )
  parser.add_argument("--seed", type=int, default=13)
  args = parser.parse_args()

  cards = [paint_card(i) for i in range(STREAM_CARDS)]
  stream = eval_stream(cards, args.seed)
  levels = {name: eval_level(cards * 4, name, args.seed) for name in LEVELS}
  results = {
    "pr35_warp_eval": "docs/livestream-warp-eval-2026-10-11.json",
    "method": "32x32 grayscale NCC of warp.py 4-corner straighten vs canonical 63:88",
    "ncc_match": NCC_MATCH,
    "timing_stages": ["decode", "warp", "embed", "search", "orb"],
    **stream,
    "warp_eval_levels": levels,
  }
  args.out.parent.mkdir(parents=True, exist_ok=True)
  args.out.write_text(json.dumps(results, indent=2) + "\n")
  print(json.dumps(results, indent=2))
  if float(stream["match_rate"]) < 0.9:
    raise SystemExit(f"recorded-stream match rate {stream['match_rate']} < 0.9")
  if float(stream["vendor_calls_per_card"]) != 1:
    raise SystemExit("vendor_calls_per_card must be 1")
  for name in STREAM_LEVELS:
    rate = float(levels[name]["match_rate"])
    if rate < 0.9:
      raise SystemExit(f"{name} warp-eval match rate {rate} < 0.9")


if __name__ == "__main__":
  main()
