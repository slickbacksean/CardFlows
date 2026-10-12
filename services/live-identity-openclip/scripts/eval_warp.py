#!/usr/bin/env python3
"""
Before/after for straightening the livestream crop (fix 2 of the scanner scan).

There are no labeled real stream frames in the repo yet, so this is SYNTHETIC:
each sampled card's high.jpg is pasted into a 640x360 "stream frame" with a
random rotation + perspective tilt on a random background, the whole frame is
blurred and JPEG-compressed like live video, then cropped two ways:

  before  axis-aligned detector box, 4% inset, max edge 448 (today's phone crop)
  after   the same crop + the 4 corners (with detector-style noise) -> warp.py

Both go through the same OpenCLIP ViT-B/32 + HNSW index as the sidecar
(cosine only, no ORB) and the same accept gate (0.86, margin 0.02).

  python scripts/eval_warp.py --index ../data/index --high ../data/eval/high [--sample 300]
"""

from __future__ import annotations

import argparse
import io
import json
import random
import sys
from pathlib import Path

import cv2
import hnswlib
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from build_tcgdex_index import load_model  # noqa: E402
from warp import warp_card  # noqa: E402

ACCEPT = 0.86
MARGIN = 0.02
FRAME_W, FRAME_H = 640, 360
LEVELS = {
  # name: (max rotation deg, max corner tilt as fraction of card size, corner noise)
  "upright": (3.0, 0.02, 0.01),
  "tilted": (15.0, 0.08, 0.015),
  "steep": (30.0, 0.14, 0.02),
}


def stream_frame(card: Image.Image, level: str, rng: random.Random):
  max_rot, max_tilt, _ = LEVELS[level]
  bg = np.zeros((FRAME_H, FRAME_W, 3), np.float32)
  base = np.array([rng.uniform(10, 120) for _ in range(3)], np.float32)
  grad = np.linspace(0, rng.uniform(-40, 40), FRAME_W, dtype=np.float32)[None, :, None]
  bg[:] = base + grad
  bg += np.random.default_rng(rng.randint(0, 1 << 30)).normal(0, 6, bg.shape).astype(np.float32)
  src = np.asarray(card.convert("RGB").resize((252, 352)), np.float32)

  h_card = rng.uniform(0.55, 0.85) * FRAME_H
  w_card = h_card * 63 / 88
  cx = rng.uniform(0.3, 0.7) * FRAME_W
  cy = rng.uniform(0.45, 0.55) * FRAME_H
  base_quad = np.array(
    [[-w_card / 2, -h_card / 2], [w_card / 2, -h_card / 2], [w_card / 2, h_card / 2], [-w_card / 2, h_card / 2]],
    np.float32,
  )
  base_quad += np.array(
    [[rng.uniform(-1, 1) * max_tilt * w_card, rng.uniform(-1, 1) * max_tilt * h_card] for _ in range(4)],
    np.float32,
  )
  theta = np.deg2rad(rng.uniform(-max_rot, max_rot))
  rot = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]], np.float32)
  quad = base_quad @ rot.T + np.array([cx, cy], np.float32)

  m = cv2.getPerspectiveTransform(
    np.array([[0, 0], [251, 0], [251, 351], [0, 351]], np.float32), quad.astype(np.float32)
  )
  warped = cv2.warpPerspective(src, m, (FRAME_W, FRAME_H))
  mask = cv2.warpPerspective(np.ones((352, 252), np.float32), m, (FRAME_W, FRAME_H))[..., None]
  frame = warped * mask + bg * (1 - mask)

  # Live-video softness + compression on the whole frame.
  frame = cv2.GaussianBlur(frame, (0, 0), rng.uniform(0.5, 1.3))
  for c in range(3):
    frame[..., c] *= rng.uniform(0.85, 1.15)
  frame = np.clip(frame, 0, 255).astype(np.uint8)
  ok, buf = cv2.imencode(".jpg", frame[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, rng.randint(35, 60)])
  assert ok
  frame = cv2.imdecode(buf, cv2.IMREAD_COLOR)[..., ::-1]
  return Image.fromarray(frame), quad


def phone_crop(frame: Image.Image, quad: np.ndarray, noise: float, rng: random.Random):
  """Today's crop (bbox + 4% inset, max edge 448) and the corners in its pixel space."""
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


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--index", type=Path, default=ROOT / "data" / "index")
  parser.add_argument("--high", type=Path, default=ROOT / "data" / "eval" / "high")
  parser.add_argument("--sample", type=int, default=300)
  parser.add_argument("--seed", type=int, default=11)
  parser.add_argument("--out", type=Path, default=None)
  args = parser.parse_args()

  meta = json.loads((args.index / "meta.json").read_text())
  rows = meta["rows"]
  index = hnswlib.Index(space="cosine", dim=int(meta["dim"]))
  index.load_index(str(args.index / "hnsw.bin"))
  index.set_ef(200)
  indexed = {r["tcgdexId"] for r in rows}
  files = sorted(p for p in args.high.glob("*.jpg") if p.stem in indexed)
  rng = random.Random(args.seed)
  files = rng.sample(files, min(args.sample, len(files)))
  model, preprocess, device = load_model()

  import torch

  def embed(images: list[Image.Image]) -> np.ndarray:
    out = []
    for i in range(0, len(images), 32):
      batch = torch.stack([preprocess(im) for im in images[i : i + 32]]).to(device)
      with torch.no_grad():
        f = model.encode_image(batch)
        f = f / f.norm(dim=-1, keepdim=True)
      out.append(f.cpu().numpy().astype("float32"))
    return np.vstack(out)

  def score(images: list[Image.Image], truth: list[str]) -> dict[str, float]:
    labels, dists = index.knn_query(embed(images), k=5)
    sims = 1 - dists
    top1 = correct = wrong = 0
    sim_sum = 0.0
    for i, t in enumerate(truth):
      pred = rows[int(labels[i][0])]["tcgdexId"]
      s0, s1 = float(sims[i][0]), float(sims[i][1])
      sim_sum += s0
      top1 += pred == t
      if s0 >= ACCEPT and s0 - s1 >= MARGIN:
        correct += pred == t
        wrong += pred != t
    n = len(truth)
    return {
      "top1": round(100 * top1 / n, 1),
      "accepted_correct": round(100 * correct / n, 1),
      "accepted_wrong": round(100 * wrong / n, 1),
      "mean_top_similarity": round(sim_sum / n, 4),
    }

  results: dict[str, object] = {"cards": len(files), "accept": ACCEPT, "margin": MARGIN}
  for level, (_, _, noise) in LEVELS.items():
    lrng = random.Random(f"{args.seed}-{level}")
    before, after, truth = [], [], []
    fell_back = 0
    for path in files:
      frame, quad = stream_frame(Image.open(path), level, lrng)
      crop, local_quad = phone_crop(frame, quad, noise, lrng)
      straight = warp_card(crop, local_quad)
      if straight is None:
        fell_back += 1
        straight = crop
      before.append(crop)
      after.append(straight)
      truth.append(path.stem)
    results[level] = {
      "before": score(before, truth),
      "after": score(after, truth),
      "warp_fallbacks": fell_back,
    }
    print(level, json.dumps(results[level]), flush=True)
  if args.out:
    args.out.write_text(json.dumps(results, indent=2) + "\n")


if __name__ == "__main__":
  main()
