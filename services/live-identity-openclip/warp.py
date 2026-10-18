"""
Perspective-straighten a livestream card crop before embedding.

The phone sends the axis-aligned detector crop plus (when the detector has them)
the card's 4 corners in that crop's pixel space, ordered TL, TR, BR, BL. We warp
to a canonical 63x88 (portrait) image. Anything invalid returns None so the
caller keeps the old axis-aligned crop.
"""

from __future__ import annotations

import json
import math
from typing import Any

import cv2
import numpy as np
from PIL import Image

CARD_W_MM = 63.0
CARD_H_MM = 88.0
# 63:88 at 4 px/mm. OpenCLIP resizes to 224 anyway; this keeps detail for ORB.
CANON_W = 252
CANON_H = 352
# Corners may sit a little outside the crop (the phone insets its crop 4%).
MAX_OUTSIDE = 0.12
MIN_SHORT_OVER_LONG = 0.5
MAX_SHORT_OVER_LONG = 0.95
# A card already within this many degrees of upright keeps the old crop: on the
# synthetic eval the upright crop scored better top-1 than a warp from slightly
# noisy corners, while tilted cards gained a lot from the warp.
MIN_TILT_DEG = 4.0


def max_edge_tilt_deg(quad: np.ndarray) -> float:
  """Largest angle between any card edge and the nearest image axis."""
  worst = 0.0
  for i in range(4):
    dx, dy = (quad[(i + 1) % 4] - quad[i]).tolist()
    angle = abs(math.degrees(math.atan2(dy, dx))) % 90.0
    worst = max(worst, min(angle, 90.0 - angle))
  return worst


def parse_quad(raw: Any) -> np.ndarray | None:
  """Accept a JSON string or list of 8 numbers / 4 [x, y] pairs."""
  if raw is None:
    return None
  if isinstance(raw, str):
    if not raw.strip():
      return None
    try:
      raw = json.loads(raw)
    except ValueError:
      return None
  if not isinstance(raw, list):
    return None
  flat: list[float] = []
  for item in raw:
    if isinstance(item, (list, tuple)) and len(item) == 2:
      flat.extend(item)
    else:
      flat.append(item)
  if len(flat) != 8:
    return None
  try:
    values = [float(v) for v in flat]
  except (TypeError, ValueError):
    return None
  if not all(math.isfinite(v) for v in values):
    return None
  return np.asarray(values, dtype=np.float32).reshape(4, 2)


def _order(quad: np.ndarray) -> np.ndarray:
  """Re-order to TL, TR, BR, BL regardless of input order."""
  center = quad.mean(axis=0)
  angles = np.arctan2(quad[:, 1] - center[1], quad[:, 0] - center[0])
  ordered = quad[np.argsort(angles)]  # starts near -pi: TL in image coords (y down)
  # argsort by angle gives TL, TR, BR, BL for y-down coordinates.
  return ordered


def quad_is_usable(quad: np.ndarray, width: int, height: int) -> bool:
  if width < 8 or height < 8:
    return False
  lo_x, hi_x = -MAX_OUTSIDE * width, (1 + MAX_OUTSIDE) * width
  lo_y, hi_y = -MAX_OUTSIDE * height, (1 + MAX_OUTSIDE) * height
  if not (np.all(quad[:, 0] >= lo_x) and np.all(quad[:, 0] <= hi_x)):
    return False
  if not (np.all(quad[:, 1] >= lo_y) and np.all(quad[:, 1] <= hi_y)):
    return False
  if not cv2.isContourConvex(quad.reshape(-1, 1, 2)):
    return False
  area = abs(cv2.contourArea(quad))
  if area < 0.2 * width * height:
    return False
  sides = [float(np.linalg.norm(quad[(i + 1) % 4] - quad[i])) for i in range(4)]
  short = (sides[0] + sides[2]) / 2
  long = (sides[1] + sides[3]) / 2
  ratio = min(short, long) / max(short, long, 1e-6)
  return MIN_SHORT_OVER_LONG <= ratio <= MAX_SHORT_OVER_LONG


def warp_card(image: Image.Image, raw_quad: Any) -> Image.Image | None:
  quad = parse_quad(raw_quad)
  if quad is None:
    return None
  quad = _order(quad)
  rgb = np.asarray(image.convert("RGB"))
  height, width = rgb.shape[:2]
  if not quad_is_usable(quad, width, height):
    return None
  if max_edge_tilt_deg(quad) < MIN_TILT_DEG:
    return None
  top = np.linalg.norm(quad[1] - quad[0])
  side = np.linalg.norm(quad[3] - quad[0])
  if top > side:
    # Landscape in frame: rotate corner order so the long side is vertical.
    quad = np.roll(quad, -1, axis=0)
  dst = np.asarray(
    [[0, 0], [CANON_W - 1, 0], [CANON_W - 1, CANON_H - 1], [0, CANON_H - 1]], dtype=np.float32
  )
  matrix = cv2.getPerspectiveTransform(quad.astype(np.float32), dst)
  out = cv2.warpPerspective(
    rgb, matrix, (CANON_W, CANON_H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
  )
  return Image.fromarray(out)
