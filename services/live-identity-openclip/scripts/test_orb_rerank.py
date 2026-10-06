#!/usr/bin/env python3
"""Fixed near-tie fixture for ORB re-rank. No OpenCLIP model."""

from __future__ import annotations

import random
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from orb_rerank import rerank_near_tie  # noqa: E402


def _card(seed: int) -> Image.Image:
  rng = random.Random(seed)
  image = Image.new("RGB", (240, 336), (240, 236, 180))
  draw = ImageDraw.Draw(image)
  for _ in range(80):
    x = rng.randint(8, 200)
    y = rng.randint(8, 300)
    w = rng.randint(6, 28)
    h = rng.randint(6, 28)
    shade = rng.randint(0, 40)
    draw.rectangle((x, y, x + w, y + h), outline=(shade, shade, shade), width=2)
  return image


def _degrade(image: Image.Image) -> Image.Image:
  small = image.resize((160, 224), Image.Resampling.BILINEAR)
  return small.resize(image.size, Image.Resampling.BILINEAR)


def main() -> None:
  card_a = _card(1)
  card_b = _card(2)
  query = _degrade(card_a)
  cosine_order = [
    {"tcgdexId": "base4-51", "name": "Reprint", "similarity": 0.891},
    {"tcgdexId": "base1-36", "name": "Original", "similarity": 0.876},
  ]

  with tempfile.TemporaryDirectory() as tmp:
    index_dir = Path(tmp)
    empty, mode = rerank_near_tie(query, cosine_order, index_dir)
    if mode != "cosine" or [row["tcgdexId"] for row in empty] != ["base4-51", "base1-36"]:
      raise SystemExit(f"smoke without refs failed: {mode} {empty}")

    (index_dir / "base4-51.jpg").write_bytes(_jpeg(card_b))
    (index_dir / "base1-36.jpg").write_bytes(_jpeg(card_a))
    ranked, mode = rerank_near_tie(query, cosine_order, index_dir)
    ids = [row["tcgdexId"] for row in ranked]
    if mode != "orb" or ids[0] != "base1-36":
      detail = [(row.get("tcgdexId"), row.get("orbInliers")) for row in ranked]
      raise SystemExit(f"near-tie fixture did not improve: {mode} {detail}")
    print(f"near-tie fixture: cosine top base4-51 -> orb top {ids[0]} ({mode})")
    print("smoke without reference images: cosine order kept")

  images = ROOT / "data" / "images"
  original = images / "base1-36.jpg"
  reprint = images / "base4-51.jpg"
  if original.is_file() and reprint.is_file():
    query = Image.open(original).convert("RGB")
    query = query.resize((180, 250)).resize(query.size)
    ranked, mode = rerank_near_tie(
      query,
      [
        {"tcgdexId": "base4-51", "name": "Ponyta", "similarity": 0.891},
        {"tcgdexId": "base1-36", "name": "Ponyta", "similarity": 0.876},
      ],
      images.parent / "index",
    )
    if mode != "orb" or ranked[0]["tcgdexId"] != "base1-36":
      detail = [(row.get("tcgdexId"), row.get("orbInliers")) for row in ranked]
      raise SystemExit(f"base1-36 vs base4-51 did not improve: {mode} {detail}")
    print(
      f"reprint fixture: base1-36 inliers {ranked[0].get('orbInliers')} "
      f"over base4-51 {ranked[1].get('orbInliers')}"
    )


def _jpeg(image: Image.Image) -> bytes:
  import io

  buf = io.BytesIO()
  image.save(buf, format="JPEG", quality=85)
  return buf.getvalue()


if __name__ == "__main__":
  main()
