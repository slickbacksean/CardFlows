"""CardFlow-owned helper: hand the vendored detector an upright card.

This file is not part of https://github.com/stolemynikes/cardgrading.

Upstream `check_aspect_ratio` compares the quad's width/height against
63/88 in image axes, so a card lying sideways in the photo (long edge
horizontal) measures ~1.40 and fails the hard aspect gate at ~95% off, even
though the card was found cleanly. Upstream was built for scanner beds where
the card is always placed upright. Phone photos are not.

We do not loosen the gate. When the found quad is landscape and the aspect
gate failed, we treat the same quad as a card turned 90 degrees and re-run
every upstream gate on it, keeping whichever reading has fewer hard-gate
failures. Every gate and threshold still applies unchanged.
"""

from __future__ import annotations

import cv2
import numpy as np


def _quad_is_landscape(corners: np.ndarray | None) -> bool:
    if corners is None:
        return False
    tl, tr, br, bl = corners
    width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    return width > height


def _aspect_failed(result) -> bool:
    return any(g.name == "aspect_ratio" and not g.passed for g in result.gates)


def detect_upright(image: np.ndarray, thresholds: dict, detect_module):
    """Return (result, rotated) using upstream detect_and_normalize.

    When the found quad is landscape and its aspect gate failed, the same quad
    is relabelled as a portrait card (equivalent to rotating the photo 90
    degrees clockwise) and every upstream gate is re-run on it with upstream
    functions. No second contour search, so this costs milliseconds.
    """
    result = detect_module.detect_and_normalize(image, thresholds)
    if not (_aspect_failed(result) and _quad_is_landscape(result.contour)):
        return result, False

    cap_cfg = thresholds["capture"]
    corners = np.roll(result.contour, 1, axis=0)  # [bl, tl, tr, br] -> portrait
    gates = [detect_module.check_resolution(image, cap_cfg)]
    gates.append(detect_module.QualityGate("card_detection", True, "card contour found"))
    tilt_gate = detect_module.check_tilt(corners, cap_cfg)
    gates.append(tilt_gate)
    gates.append(detect_module.check_aspect_ratio(corners, cap_cfg, tilt_ok=tilt_gate.passed))
    size = (cap_cfg["canonical_width_px"], cap_cfg["canonical_height_px"])
    warped = detect_module.perspective_correct(image, corners, size)
    gates.append(detect_module.detect_glare(warped, cap_cfg["glare"]))
    gates.append(detect_module.detect_uneven_lighting(warped, cap_cfg["uneven_lighting"]))
    rotated = detect_module.DetectResult(
        ok=all(g.passed for g in gates), warped=warped, gates=gates, contour=corners
    )
    if len(rotated.hard_failures) < len(result.hard_failures):
        return rotated, True
    return result, False
