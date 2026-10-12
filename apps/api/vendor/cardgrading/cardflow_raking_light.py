"""CardFlow-owned: accept or refuse a phone "rotation set" for surface grading.

This file is not part of https://github.com/stolemynikes/cardgrading.

Upstream grades surface only from photometric stereo: 3+ captures of one
side with the card turned 90 degrees between them under one fixed, low lamp
(`grade_card(photometric_paths=...)`). It was built for a flatbed scanner,
whose lamp is always directional. A phone photo might be lit by a diffuse
ceiling light instead, and then every rotation looks the same, the solve
finds a perfectly flat card, and surface would read as flawless. That is a
guess, so it must never become a grade.

The check: divide each upright warp by the mean of all of them (cancels the
print), fit a brightness plane, and require that

* every shot has a clear brightness slope (a lamp close enough to light the
  card unevenly, i.e. one directional source), and
* the slope direction turns with the card: shot i's direction minus its
  measured rotation must agree across the set (the lamp stayed put and the
  card, not the phone, was turned).

It also returns the lamp's direction in the first shot's card frame, which
is what upstream's `lamp_azimuth` wants, instead of assuming it.

A passing set proves the light was directional and the card was turned. It
does not calibrate a phone + desk lamp against upstream's scanner-derived
surface thresholds; see the CardFlow notes in the API for that caveat.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

# Brightness change from the card's centre to its edge along the lamp
# direction, as a fraction. A diffuse room light gives ~0-2%; a lamp ~30 cm
# away at a low angle gives 10%+.
MIN_LIGHT_SLOPE = 0.05
# How far a shot's lamp direction may stray from the set's (degrees).
MAX_DIRECTION_SPREAD_DEG = 50.0
MIN_DISTINCT_ROTATIONS = 3

GRID = (63, 88)  # one cell per mm
TRIM = 0.08


def _angle_diff(a: float, b: float) -> float:
    return (a - b + 180.0) % 360.0 - 180.0


def _circular_mean(angles: list[float]) -> float:
    s = sum(math.sin(math.radians(a)) for a in angles)
    c = sum(math.cos(math.radians(a)) for a in angles)
    return math.degrees(math.atan2(s, c)) % 360.0


def light_slopes(warps: list[np.ndarray]) -> list[dict]:
    grays = []
    for warp in warps:
        gray = warp if warp.ndim == 2 else cv2.cvtColor(warp, cv2.COLOR_BGR2GRAY)
        small = cv2.resize(gray, GRID, interpolation=cv2.INTER_AREA).astype(np.float64) + 1.0
        h, w = small.shape
        dy, dx = int(round(h * TRIM)), int(round(w * TRIM))
        grays.append(small[dy : h - dy, dx : w - dx])
    mean = np.mean(grays, axis=0)
    h, w = mean.shape
    ys, xs = np.mgrid[0:h, 0:w]
    x = (xs / (w - 1)) * 2.0 - 1.0  # -1 left .. +1 right
    y = 1.0 - (ys / (h - 1)) * 2.0  # +1 top .. -1 bottom (card frame, y up)
    design = np.stack([np.ones(x.size), x.ravel(), y.ravel()], axis=1)
    out = []
    for gray in grays:
        ratio = (gray / mean).ravel()
        (a, b, c), *_ = np.linalg.lstsq(design, ratio, rcond=None)
        slope = math.hypot(b, c) / max(a, 1e-6)
        # Brighter side = where the lamp is. Azimuth CCW from the card's right
        # edge, the convention upstream's light_vectors uses.
        azimuth = math.degrees(math.atan2(c, b)) % 360.0
        out.append({"slope": round(float(slope), 4), "azimuth_deg": round(float(azimuth), 1)})
    return out


def check_rotation_set(warps: list[np.ndarray], rotations_ccw: list[int]) -> dict:
    """{ok, reason, lamp_azimuth_deg, shots}. `rotations_ccw` as upstream's normalise_scan."""
    if len(warps) < MIN_DISTINCT_ROTATIONS:
        return {"ok": False, "reason": "too_few", "lamp_azimuth_deg": None, "shots": []}
    if len({r % 360 for r in rotations_ccw}) < MIN_DISTINCT_ROTATIONS:
        return {"ok": False, "reason": "not_rotated", "lamp_azimuth_deg": None, "shots": []}
    shots = light_slopes(warps)
    for shot, ccw in zip(shots, rotations_ccw):
        shot["rotation_deg"] = int(ccw)
        # A card turned clockwise by theta sees the lamp at lamp + theta.
        shot["lamp_deg"] = round((shot["azimuth_deg"] - ccw) % 360.0, 1)
    if min(shot["slope"] for shot in shots) < MIN_LIGHT_SLOPE:
        return {"ok": False, "reason": "no_directional_light", "lamp_azimuth_deg": None, "shots": shots}
    lamp = _circular_mean([shot["lamp_deg"] for shot in shots])
    spread = max(abs(_angle_diff(shot["lamp_deg"], lamp)) for shot in shots)
    if spread > MAX_DIRECTION_SPREAD_DEG:
        return {"ok": False, "reason": "light_did_not_turn_with_card", "lamp_azimuth_deg": round(lamp, 1), "shots": shots}
    return {"ok": True, "reason": None, "lamp_azimuth_deg": round(lamp, 1), "shots": shots}
