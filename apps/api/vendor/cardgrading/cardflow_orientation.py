"""CardFlow-owned helper: hand the vendored detector an upright card.

This file is not part of https://github.com/stolemynikes/cardgrading.

Upstream `check_aspect_ratio` compares the quad's width/height against
63/88 in image axes, so a card lying sideways in the photo (long edge
horizontal) measures ~1.40 and fails the hard aspect gate at ~95% off, even
though the card was found cleanly. Upstream was built for scanner beds where
the card is always placed upright. Phone photos are not.

P0-04: rotate the found quad to portrait BEFORE the aspect check. A sideways
card is ~95% off 63:88, so a looser 8% gate never saved those photos —
rotation does. Aspect then runs on a portrait quad with the documented
tolerances in calibration/thresholds.json:

* 3% (`aspect_ratio_tolerance_pct`) — default after portrait correction.
* 8% (`aspect_ratio_tolerance_upright_pct`) — only when tilt already passed,
  for perspective foreshortening on a real rectangle (measured 3–8% on phone
  captures; misdetections sit at 15–28%). Chosen pending the P0-20 frozen
  set: tighten the 8% path only if false retakes stay at or below 2%.
"""

from __future__ import annotations

import numpy as np


def _quad_is_landscape(corners: np.ndarray | None) -> bool:
    if corners is None:
        return False
    tl, tr, br, bl = corners
    width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    return width > height


def portrait_corners(corners: np.ndarray) -> tuple[np.ndarray, bool]:
    """Return (portrait-labelled quad, rotated).

    `np.roll(..., 1)` is a 90-degree clockwise relabel:
    [tl, tr, br, bl] → [bl, tl, tr, br]. No pixel rotate, no second search.
    """
    if not _quad_is_landscape(corners):
        return corners, False
    return np.roll(corners, 1, axis=0), True


def detect_upright(image: np.ndarray, thresholds: dict, detect_module):
    """Find the card, force portrait, then run capture gates.

    Same gate sequence as upstream `detect_and_normalize`, with the 90-degree
    portrait relabel inserted after the contour is found and before tilt /
    aspect. Sideways photos therefore reach the aspect check as 63:88, not
    88:63.
    """
    cap_cfg = thresholds["capture"]
    gates = [detect_module.check_resolution(image, cap_cfg)]

    corners = detect_module.find_card_contour(image)
    if corners is None:
        gates.append(detect_module.QualityGate("card_detection", False, "no card contour found"))
        return detect_module.DetectResult(ok=False, warped=None, gates=gates, contour=None), False

    gates.append(detect_module.QualityGate("card_detection", True, "card contour found"))
    corners, rotated = portrait_corners(corners)

    tilt_gate = detect_module.check_tilt(corners, cap_cfg)
    gates.append(tilt_gate)
    gates.append(detect_module.check_aspect_ratio(corners, cap_cfg, tilt_ok=tilt_gate.passed))

    size = (cap_cfg["canonical_width_px"], cap_cfg["canonical_height_px"])
    warped = detect_module.perspective_correct(image, corners, size)
    gates.append(detect_module.detect_glare(warped, cap_cfg["glare"]))
    gates.append(detect_module.detect_uneven_lighting(warped, cap_cfg["uneven_lighting"]))

    result = detect_module.DetectResult(
        ok=all(g.passed for g in gates), warped=warped, gates=gates, contour=corners
    )
    return result, rotated
