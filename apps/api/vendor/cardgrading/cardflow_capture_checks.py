"""CardFlow-owned capture checks: sharpness and effective scale (DPI).

This file is not part of https://github.com/stolemynikes/cardgrading.

Upstream gates check that a card was found flat and evenly lit, but not that
the photo is in focus or that the card is big enough in the frame. Phone
photos taken too close for the lens to focus come out uniformly soft, and
upstream still scores them (soft corners and edges read as "clean").

Both checks run on the same quad / canonical warp upstream already produced,
so nothing is re-detected.

* sharpness: variance of the Laplacian on the card face, measured on the
  canonical warp downsampled to 750x1050 with a 6% border trimmed. Fixing the
  measurement size keeps photos taken at different distances comparable (a
  raw-warp Laplacian mostly measures how much the warp upscaled).
* effective DPI: the card is a known 63 x 88 mm, so pixels per mm in the
  capture = quad side length / physical side length. The two axes are
  computed independently; their agreement is a sanity check on the quad.
  This scale is derived from the card itself, so it can not be used to
  measure the card's own size (that would be circular): it tells us how
  much real detail the corner and edge measurements have to work with.
"""

from __future__ import annotations

import cv2
import numpy as np

CARD_WIDTH_MM = 63.0
CARD_HEIGHT_MM = 88.0
MM_PER_INCH = 25.4

SHARPNESS_SIZE = (750, 1050)
SHARPNESS_TRIM = 0.06
# Measured 2026-10-05 on Sean's real photos (lap750): in-app camera photos
# that look soft scored 20-70; system-camera photos that look sharp 217-381.
MIN_SHARPNESS = 90.0
# Upstream measures on a ~605 dpi canonical warp. Below ~300 dpi the warp
# upscales more than 2x and corner/edge wear is invented by interpolation.
MIN_EFFECTIVE_DPI = 300.0
# Between the two, measurements still run but a closer photo will score more
# reliably.
LOW_EFFECTIVE_DPI = 420.0


def _side_lengths(corners: np.ndarray) -> tuple[float, float]:
    quad = np.asarray(corners, dtype=np.float64).reshape(4, 2)
    tl, tr, br, bl = quad
    width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2.0
    height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2.0
    return float(width), float(height)


def effective_scale(corners: np.ndarray | None) -> dict | None:
    """Pixels per mm / DPI of the card in the original capture."""
    if corners is None:
        return None
    width, height = _side_lengths(corners)
    short_px, long_px = min(width, height), max(width, height)
    if short_px <= 0:
        return None
    ppmm_short = short_px / CARD_WIDTH_MM
    ppmm_long = long_px / CARD_HEIGHT_MM
    ppmm = (ppmm_short + ppmm_long) / 2.0
    return {
        "card_px": [round(short_px, 1), round(long_px, 1)],
        "px_per_mm": round(ppmm, 2),
        "effective_dpi": round(ppmm * MM_PER_INCH, 1),
        # 1.0 = both axes agree on the scale (a clean, flat quad).
        "axis_agreement": round(min(ppmm_short, ppmm_long) / max(ppmm_short, ppmm_long), 4),
    }


def sharpness(warped: np.ndarray | None) -> float | None:
    """Laplacian variance of the card face at a fixed measurement size."""
    if warped is None or warped.size == 0:
        return None
    gray = warped if warped.ndim == 2 else cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, SHARPNESS_SIZE, interpolation=cv2.INTER_AREA)
    h, w = small.shape[:2]
    dy, dx = int(round(h * SHARPNESS_TRIM)), int(round(w * SHARPNESS_TRIM))
    face = small[dy : h - dy, dx : w - dx]
    return round(float(cv2.Laplacian(face, cv2.CV_64F).var()), 1)


def _gate(name: str, passed: bool, detail: str, value: float | None, hard: bool) -> dict:
    # Same JSON shape as upstream QualityGate.to_dict(); `hard` is explicit
    # because upstream derives it from a fixed set of names.
    return {"name": name, "passed": bool(passed), "detail": detail, "value": value, "hard": hard}


def capture_checks(warped: np.ndarray | None, corners: np.ndarray | None) -> dict:
    """Metrics plus upstream-shaped gate dicts (hard = retake, never a grade)."""
    sharp = sharpness(warped)
    scale = effective_scale(corners)
    gates: list[dict] = []
    if sharp is not None:
        gates.append(
            _gate(
                "sharpness",
                sharp >= MIN_SHARPNESS,
                f"laplacian variance={sharp:.1f} (min {MIN_SHARPNESS:.0f})",
                sharp,
                True,
            )
        )
    if scale is not None:
        dpi = scale["effective_dpi"]
        gates.append(
            _gate(
                "capture_scale",
                dpi >= MIN_EFFECTIVE_DPI,
                f"effective dpi={dpi:.0f} (min {MIN_EFFECTIVE_DPI:.0f})",
                dpi,
                True,
            )
        )
        if dpi >= MIN_EFFECTIVE_DPI:
            gates.append(
                _gate(
                    "capture_scale_low",
                    dpi >= LOW_EFFECTIVE_DPI,
                    f"effective dpi={dpi:.0f} (closer below {LOW_EFFECTIVE_DPI:.0f})",
                    dpi,
                    False,
                )
            )
    metrics = {"sharpness": sharp, "min_sharpness": MIN_SHARPNESS, **(scale or {})}
    return {"metrics": metrics, "gates": gates}
