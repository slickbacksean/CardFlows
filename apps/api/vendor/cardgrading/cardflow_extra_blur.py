"""CardFlow-owned: server-side blur check for full-grade extra shots.

Not part of https://github.com/stolemynikes/cardgrading.

Extras are blur-checked on the phone first; this re-checks on the server so a
bypassed client can't store unusable tilted or corner close-ups. Same Laplacian
variance idea as cardflow_capture_checks, measured on a fixed-size crop of the
whole still (extras are not full-card warps).
"""

from __future__ import annotations

import cv2
import numpy as np

# Slightly looser than the flat-card gate (90): close-ups and tilted shots have
# less print detail in frame. Tuned on synthetic sharp vs soft cards; rechecked
# against group-6-major-project/card-grader crops (see scripts/eval_full_extras.py).
MIN_EXTRA_SHARPNESS = 60.0
MEASURE_SIZE = (640, 640)


def sharpness_of_still(image_bgr: np.ndarray) -> float | None:
    if image_bgr is None or image_bgr.size == 0:
        return None
    gray = image_bgr if image_bgr.ndim == 2 else cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, MEASURE_SIZE, interpolation=cv2.INTER_AREA)
    return round(float(cv2.Laplacian(small, cv2.CV_64F).var()), 1)


def check_extra_blur(image_bgr: np.ndarray) -> dict:
    """Return {ok, sharpness, min_sharpness, reason?}."""
    sharp = sharpness_of_still(image_bgr)
    if sharp is None:
        return {
            "ok": False,
            "sharpness": None,
            "min_sharpness": MIN_EXTRA_SHARPNESS,
            "reason": "Couldn't read the photo",
        }
    ok = sharp >= MIN_EXTRA_SHARPNESS
    out = {"ok": ok, "sharpness": sharp, "min_sharpness": MIN_EXTRA_SHARPNESS}
    if not ok:
        out["reason"] = "Too blurry. Move back a little and retake."
    return out


def check_extra_blur_path(path: str) -> dict:
    image = cv2.imread(path)
    if image is None:
        return {
            "ok": False,
            "sharpness": None,
            "min_sharpness": MIN_EXTRA_SHARPNESS,
            "reason": "Couldn't read the photo",
        }
    return check_extra_blur(image)
