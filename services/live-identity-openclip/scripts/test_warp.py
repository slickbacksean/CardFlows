#!/usr/bin/env python3
"""Checks for warp.py.  python scripts/test_warp.py"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from warp import CANON_H, CANON_W, parse_quad, warp_card  # noqa: E402


def tilted_card() -> tuple[Image.Image, list[float]]:
  card = np.zeros((352, 252, 3), np.uint8)
  card[:176] = (255, 0, 0)  # red top half
  card[176:] = (0, 0, 255)  # blue bottom half
  quad = np.array([[60, 30], [230, 50], [215, 290], [40, 270]], np.float32)
  m = cv2.getPerspectiveTransform(np.array([[0, 0], [251, 0], [251, 351], [0, 351]], np.float32), quad)
  frame = cv2.warpPerspective(card, m, (280, 320), borderValue=(30, 160, 30))
  return Image.fromarray(frame), quad.reshape(-1).tolist()


def main() -> None:
  image, quad = tilted_card()
  out = warp_card(image, quad)
  assert out is not None and out.size == (CANON_W, CANON_H)
  arr = np.asarray(out)
  assert arr[40, CANON_W // 2, 0] > 200 and arr[40, CANON_W // 2, 2] < 60, "top should be red"
  assert arr[CANON_H - 40, CANON_W // 2, 2] > 200, "bottom should be blue"
  # Corner order does not matter.
  shuffled = quad[4:6] + quad[0:2] + quad[6:8] + quad[2:4]
  again = np.asarray(warp_card(image, shuffled))
  assert np.abs(again.astype(int) - arr.astype(int)).mean() < 2
  # JSON string input.
  assert warp_card(image, str(quad)) is not None
  # Invalid inputs fall back (None) so the caller keeps the old crop.
  assert parse_quad([1, 2, 3]) is None
  assert warp_card(image, None) is None
  assert warp_card(image, [0, 0, 1, 0, 1, 1, 0, 1]) is None  # too small
  assert warp_card(image, [0, 0, 5000, 0, 5000, 5000, 0, 5000]) is None  # outside
  # Already upright: keep the old crop.
  assert warp_card(image, [5, 5, 255, 6, 254, 305, 4, 304]) is None
  print("warp ok")


if __name__ == "__main__":
  main()
