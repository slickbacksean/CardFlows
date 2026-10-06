"""
ORB inlier re-rank for OpenCLIP HNSW near-ties.

Same idea as pokemon-scanner match/rerank.py (MIT). CardFlow-owned. Uses
contrib-free cv2.ORB. Missing OpenCV, a missing reference image, or a matcher
error skips that row and leaves cosine order in place.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

# Enough RANSAC inliers to trust a reprint split, and a lead over the runner-up.
MIN_INLIERS = 12
MIN_LEAD = 8


def reference_image_path(index_dir: Path, tcgdex_id: str) -> Path | None:
  """Local TCGdex art for ORB. Never downloads. None if the file is absent."""
  if not tcgdex_id or "/" in tcgdex_id or ".." in tcgdex_id:
    return None
  roots: list[Path] = []
  configured = os.environ.get("LIVE_IDENTITY_REF_DIR", "").strip()
  if configured:
    roots.append(Path(configured).expanduser())
  roots.append(index_dir / "images")
  roots.append(index_dir)
  roots.append(index_dir.parent / "images")
  seen: set[Path] = set()
  for root in roots:
    if root in seen:
      continue
    seen.add(root)
    for ext in (".jpg", ".png"):
      path = root / f"{tcgdex_id}{ext}"
      if path.is_file():
        return path
  return None


def _pil_to_bgr(image: Image.Image) -> np.ndarray:
  rgb = np.asarray(image.convert("RGB"))
  return rgb[:, :, ::-1].copy()


def count_orb_inliers(query_bgr: np.ndarray, ref_bgr: np.ndarray) -> int | None:
  """Homography inliers between two BGR images. None means ORB could not run."""
  try:
    import cv2
  except ImportError:
    return None
  try:
    orb = cv2.ORB_create(nfeatures=600)
    query_gray = cv2.cvtColor(query_bgr, cv2.COLOR_BGR2GRAY)
    ref_gray = cv2.cvtColor(ref_bgr, cv2.COLOR_BGR2GRAY)
    keypoints_q, desc_q = orb.detectAndCompute(query_gray, None)
    keypoints_r, desc_r = orb.detectAndCompute(ref_gray, None)
    if desc_q is None or desc_r is None or len(desc_q) < 8 or len(desc_r) < 8:
      return 0
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    pairs = matcher.knnMatch(desc_q, desc_r, k=2)
    good = []
    for pair in pairs:
      if len(pair) < 2:
        continue
      best, second = pair
      if best.distance < 0.75 * second.distance:
        good.append(best)
    if len(good) < 8:
      return len(good)
    src = np.float32([keypoints_q[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([keypoints_r[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    _homography, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
    if mask is None:
      return len(good)
    return int(mask.ravel().sum())
  except Exception:
    return None


def _load_ref_bgr(path: Path) -> np.ndarray | None:
  try:
    import cv2
  except ImportError:
    return None
  image = cv2.imread(str(path), cv2.IMREAD_COLOR)
  if image is None:
    return None
  return image


def rerank_near_tie(
  query: Image.Image,
  candidates: list[dict[str, Any]],
  index_dir: Path,
) -> tuple[list[dict[str, Any]], str]:
  """
  Re-order HNSW candidates when ORB inliers split a near-tie.

  Returns (candidates, "orb" | "cosine"). "cosine" means re-rank was skipped
  or did not beat the runner-up. Cosine similarity values are left unchanged.
  """
  if len(candidates) < 2:
    return candidates, "cosine"
  try:
    query_bgr = _pil_to_bgr(query)
  except Exception:
    return candidates, "cosine"

  scored: list[tuple[int, dict[str, Any]]] = []
  any_ref = False
  for candidate in candidates:
    tcgdex_id = str(candidate.get("tcgdexId") or "")
    path = reference_image_path(index_dir, tcgdex_id)
    if path is None:
      scored.append((-1, candidate))
      continue
    any_ref = True
    ref = _load_ref_bgr(path)
    if ref is None:
      scored.append((-1, candidate))
      continue
    inliers = count_orb_inliers(query_bgr, ref)
    if inliers is None:
      return candidates, "cosine"
    next_row = dict(candidate)
    next_row["orbInliers"] = inliers
    scored.append((inliers, next_row))

  if not any_ref:
    return candidates, "cosine"

  ranked = sorted(scored, key=lambda item: item[0], reverse=True)
  best_inliers, best = ranked[0]
  second_inliers = ranked[1][0]
  if best_inliers < MIN_INLIERS or best_inliers - max(second_inliers, 0) < MIN_LEAD:
    return candidates, "cosine"

  ordered = [row for _inliers, row in ranked]
  # Keep unscored cosine rows (inliers -1) after scored ones, stable by original order.
  return ordered, "orb"
