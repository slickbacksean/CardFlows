"""CardFlow-owned: corner close-up whitening + rounding check.

Not part of https://github.com/stolemynikes/cardgrading.

Each close-up is rectified to a fixed corner patch (card corner at a known
location), then:
  * whitening/fraying — bright border pixels vs estimated border colour
  * rounding/dings — how far the outer contour sits from the expected radius

Score is 0–10 (10 = clean). Combination with the flat-photo corner score is
documented in combine_corner_scores (take the worse measurable score).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

CORNER_NAMES = ("tl", "tr", "br", "bl")
# Output rectified patch: corner tip near (margin, margin) after flip.
PATCH = 256
MARGIN = 28
# Expected tip radius in patch pixels for a mint modern TCG corner (~0.5–1 mm).
EXPECTED_RADIUS_PX = 12.0
# Whitening: fraction of border-band pixels that are much brighter than the
# median border colour. Tuned on card-grader Corner Wear boxes.
WHITEN_DELTA = 36.0
WHITEN_BAND_PX = 12
# Grade bands: max whitening_pct / max radius_deviation_px → grade floor.
WHITEN_BANDS = [
    (3.0, 10),
    (6.0, 9),
    (10.0, 8),
    (16.0, 7),
    (24.0, 6),
    (35.0, 5),
    (50.0, 4),
    (65.0, 3),
    (80.0, 2),
    (100.0, 1),
]
RADIUS_BANDS = [
    (6.0, 10),
    (10.0, 9),
    (14.0, 8),
    (20.0, 7),
    (28.0, 6),
    (38.0, 5),
    (50.0, 4),
    (65.0, 3),
    (85.0, 2),
    (1e9, 1),
]

CORNER_LABELS = {
    "tl": "top-left",
    "tr": "top-right",
    "br": "bottom-right",
    "bl": "bottom-left",
}


@dataclass
class CornerCloseupResult:
    corner: str  # tl|tr|br|bl
    score: int | None
    whitening_pct: float
    radius_deviation_px: float
    measurable: bool
    note: str | None = None
    reason: str | None = None

    def to_dict(self) -> dict:
        return {
            "corner": self.corner,
            "score": self.score,
            "whitening_pct": round(self.whitening_pct, 3),
            "radius_deviation_px": round(self.radius_deviation_px, 2),
            "measurable": self.measurable,
            "note": self.note,
            "reason": self.reason,
        }


def _grade_from_pct(pct: float, bands: list[tuple[float, int]]) -> int:
    for ceiling, grade in bands:
        if pct <= ceiling:
            return grade
    return 1


def _find_card_corner_quad(gray: np.ndarray) -> np.ndarray | None:
    """Rough card outline → ordered TL,TR,BR,BL quad in image coords, or None."""
    h, w = gray.shape[:2]
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 40, 120)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(contour)
    if area < 0.05 * h * w:
        return None
    peri = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
    if len(approx) < 4:
        rect = cv2.minAreaRect(contour)
        box = cv2.boxPoints(rect)
    else:
        # Take the 4 points of the largest-area approx if more than 4.
        pts = approx.reshape(-1, 2).astype(np.float32)
        if len(pts) > 4:
            # Hull then min-area rect for stability.
            hull = cv2.convexHull(pts)
            rect = cv2.minAreaRect(hull)
            box = cv2.boxPoints(rect)
        else:
            box = pts
    return _order_quad(box.astype(np.float32))


def _order_quad(pts: np.ndarray) -> np.ndarray:
    """Order as TL, TR, BR, BL."""
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).reshape(-1)
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(diff)]
    bl = pts[np.argmax(diff)]
    return np.array([tl, tr, br, bl], dtype=np.float32)


def _rectify_corner(image_bgr: np.ndarray, corner: str) -> np.ndarray | None:
    """Warp so the named card corner sits at top-left of a PATCH×PATCH crop."""
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    quad = _find_card_corner_quad(gray)
    h, w = gray.shape[:2]
    if quad is None:
        # Fallback: assume the guide box put the corner near the matching
        # screen quadrant — take that image corner region.
        regions = {
            "tl": (0, 0, w // 2, h // 2),
            "tr": (w // 2, 0, w, h // 2),
            "br": (w // 2, h // 2, w, h),
            "bl": (0, h // 2, w // 2, h),
        }
        x0, y0, x1, y1 = regions[corner]
        crop = image_bgr[y0:y1, x0:x1]
        if crop.size == 0:
            return None
        return cv2.resize(crop, (PATCH, PATCH), interpolation=cv2.INTER_AREA)

    idx = {"tl": 0, "tr": 1, "br": 2, "bl": 3}[corner]
    # Build a local parallelogram around the corner using adjacent edges.
    c = quad[idx]
    prev_i = (idx - 1) % 4
    next_i = (idx + 1) % 4
    along_a = quad[next_i] - c
    along_b = quad[prev_i] - c
    # Use ~18% of each edge length so we stay on the border/corner.
    la = np.linalg.norm(along_a)
    lb = np.linalg.norm(along_b)
    if la < 8 or lb < 8:
        return None
    a = c + along_a * min(0.22, 180.0 / la)
    b = c + along_b * min(0.22, 180.0 / lb)
    d = c + (a - c) + (b - c)
    src = np.array([c, a, d, b], dtype=np.float32)
    dst = np.array(
        [
            [MARGIN, MARGIN],
            [PATCH - 1, MARGIN],
            [PATCH - 1, PATCH - 1],
            [MARGIN, PATCH - 1],
        ],
        dtype=np.float32,
    )
    H = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(image_bgr, H, (PATCH, PATCH), flags=cv2.INTER_LINEAR)


def _whitening_pct(patch_bgr: np.ndarray) -> float:
    """Fraction of the coloured border near the tip that looks like exposed stock."""
    lab = cv2.cvtColor(patch_bgr, cv2.COLOR_BGR2LAB)
    L = lab[:, :, 0].astype(np.float32)
    tip_med = float(np.median(L[:36, :36]))
    yy, xx = np.ogrid[:PATCH, :PATCH]
    near = (xx < 150) & (yy < 150) & ((xx + yy) < 220)
    on_card = near & (np.abs(L - tip_med) >= 12)
    if not np.any(on_card):
        return 0.0
    border = on_card & (L >= np.percentile(L[on_card], 35))
    if not np.any(border):
        border = on_card
    med = float(np.median(L[border]))
    white_frac = float(np.count_nonzero(border & (L >= 230))) / float(np.count_nonzero(border))
    if med >= 220 or white_frac >= 0.35:
        return 100.0 * max(white_frac, 0.4)
    hot = border & ((L > med + WHITEN_DELTA) | (L >= 230))
    return 100.0 * float(np.count_nonzero(hot)) / float(np.count_nonzero(border))


def _radius_deviation_px(patch_bgr: np.ndarray) -> float:
    """How far the outer contour near the tip sits from EXPECTED_RADIUS_PX."""
    gray = cv2.cvtColor(patch_bgr, cv2.COLOR_BGR2GRAY)
    # Tip neighbourhood.
    r = 48
    x0, y0 = max(0, MARGIN - 4), max(0, MARGIN - 4)
    crop = gray[y0 : y0 + r, x0 : x0 + r]
    if crop.size == 0:
        return 0.0
    blur = cv2.GaussianBlur(crop, (3, 3), 0)
    _, thr = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Card is usually the brighter (or darker) blob; pick the one touching tip.
    # Invert if needed so card is white.
    if thr[min(8, thr.shape[0] - 1), min(8, thr.shape[1] - 1)] < 128:
        thr = 255 - thr
    contours, _ = cv2.findContours(thr, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return 0.0
    contour = max(contours, key=cv2.contourArea)
    # Distances from tip (MARGIN,MARGIN) in full-patch coords.
    tip = np.array([MARGIN - x0, MARGIN - y0], dtype=np.float32)
    pts = contour.reshape(-1, 2).astype(np.float32)
    # Keep points in the first quadrant relative to tip (along the two edges).
    rel = pts - tip
    mask = (rel[:, 0] >= -2) & (rel[:, 1] >= -2) & (rel[:, 0] < r) & (rel[:, 1] < r)
    # Prefer the arc facing into the card (x>0,y>0).
    arc = rel[(rel[:, 0] > 1) & (rel[:, 1] > 1)]
    if len(arc) < 8:
        arc = rel[mask]
    if len(arc) < 8:
        return 0.0
    dists = np.linalg.norm(arc, axis=1)
    # Robust: median distance of the near-tip arc vs expected radius.
    near = dists[dists < EXPECTED_RADIUS_PX * 4]
    if len(near) < 4:
        near = dists
    med = float(np.median(near))
    return abs(med - EXPECTED_RADIUS_PX)


def _corner_structure_ok(patch_bgr: np.ndarray) -> bool:
    """True when tip neighbourhood differs from the card interior (an L-corner)."""
    gray = cv2.cvtColor(patch_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    tip = gray[:56, :56]
    interior = gray[120:200, 120:200]
    if tip.size == 0 or interior.size == 0:
        return False
    mean_delta = abs(float(tip.mean()) - float(interior.mean()))
    gx = np.abs(np.diff(gray[:90, :90], axis=1)).mean()
    gy = np.abs(np.diff(gray[:90, :90], axis=0)).mean()
    return mean_delta >= 8.0 and (gx + gy) >= 0.15


def analyze_corner_closeup(image_bgr: np.ndarray, corner: str) -> CornerCloseupResult:
    if corner not in CORNER_NAMES:
        return CornerCloseupResult(corner, None, 0.0, 0.0, False, reason="unknown corner")
    patch = _rectify_corner(image_bgr, corner)
    if patch is None:
        return CornerCloseupResult(
            corner, None, 0.0, 0.0, False, reason="Couldn't find the card corner in this close-up"
        )
    if not _corner_structure_ok(patch):
        return CornerCloseupResult(
            corner, None, 0.0, 0.0, False, reason="Couldn't lock onto the card corner in this close-up"
        )
    whiten = _whitening_pct(patch)
    radius_dev = _radius_deviation_px(patch)
    g_w = _grade_from_pct(whiten, WHITEN_BANDS)
    g_r = _grade_from_pct(radius_dev, RADIUS_BANDS)
    # Whitening primary; rounding only for a clear ding (radius grade ≤5).
    if g_r <= 5 and g_r < g_w:
        score = g_r
        wear_note = True
    else:
        score = g_w
        wear_note = False
    note = None
    label = CORNER_LABELS[corner]
    if score <= 8:
        note = f"Wear on {label} corner" if wear_note else f"Whitening on {label} corner"
    return CornerCloseupResult(corner, score, whiten, radius_dev, True, note=note)


def combine_corner_scores(flat_score: int | None, closeup_score: int | None) -> int | None:
    """Documented combine rule: take the worse (min) of measurable scores.

    A missing close-up leaves the flat score unchanged. A missing flat score
    (unmeasurable border on the flat warp) uses the close-up alone.
    """
    scores = [s for s in (flat_score, closeup_score) if s is not None]
    if not scores:
        return None
    return min(scores)


@dataclass
class SideCornerCloseups:
    corners: dict[str, CornerCloseupResult] = field(default_factory=dict)

    @property
    def side_score(self) -> int | None:
        measured = [c.score for c in self.corners.values() if c.measurable and c.score is not None]
        return min(measured) if measured else None

    def to_dict(self) -> dict:
        return {
            "corners": {k: v.to_dict() for k, v in self.corners.items()},
            "side_score": self.side_score,
        }
