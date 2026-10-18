"""CardFlow-owned: surface check from flat + 2 phone-tilt shots.

Not part of https://github.com/stolemynikes/cardgrading.

Photometric stereo needs the *light* to move. Tilting the phone moves the
camera, so we do not claim a normal map. Instead:

  1. Detect/warp each tilt shot onto the flat card with a homography.
  2. Normalize lighting (per-image mean/std on the card face).
  3. Difference-of-normalized-images: specular/edge anomalies that appear in
     one tilt but not the others → scratch / crease / dent candidates.
  4. Line + blob detection → surface sub-score (0–10) and a defect mask.

Tuned on group-6-major-project/card-grader Scratch boxes (threshold eval only).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

CANON_W, CANON_H = 420, 588  # ~63:88 at a modest size for speed
FACE_TRIM = 0.04
# Difference threshold after |tilt - flat| on normalized [0,1] face.
DIFF_THRESH = 0.16
MIN_LINE_LEN = 36
MIN_BLOB_AREA = 55
# Score bands from defect area % of face + longest line (px at CANON size).
AREA_BANDS = [
    (0.05, 10),
    (0.15, 9),
    (0.35, 8),
    (0.7, 7),
    (1.4, 6),
    (2.5, 5),
    (4.5, 4),
    (8.0, 3),
    (15.0, 2),
    (100.0, 1),
]
LINE_BANDS = [
    (0, 10),
    (40, 9),
    (70, 8),
    (110, 7),
    (160, 6),
    (220, 5),
    (300, 4),
    (400, 3),
    (550, 2),
    (1e9, 1),
]


@dataclass
class SurfaceDefect:
    kind: str  # scratch | crease | dent
    length_px: float
    area_px: float
    box: list[float]  # x,y,w,h in 0..1 of canonical warp
    note: str

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "length_px": round(self.length_px, 1),
            "area_px": round(self.area_px, 1),
            "box": [round(v, 4) for v in self.box],
            "note": self.note,
        }


@dataclass
class TiltSurfaceResult:
    score: int | None
    measurable: bool
    defect_area_pct: float
    longest_line_px: float
    defects: list[SurfaceDefect] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    reason: str | None = None
    # PNG bytes of the binary mask (optional; filled by caller if needed)
    mask_present: bool = False

    def to_dict(self) -> dict:
        return {
            "score": self.score,
            "measurable": self.measurable,
            "defect_area_pct": round(self.defect_area_pct, 3),
            "longest_line_px": round(self.longest_line_px, 1),
            "defects": [d.to_dict() for d in self.defects[:12]],
            "notes": self.notes[:8],
            "reason": self.reason,
            "mask_present": self.mask_present,
        }


def _order_quad(pts: np.ndarray) -> np.ndarray:
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).reshape(-1)
    return np.array(
        [pts[np.argmin(s)], pts[np.argmin(diff)], pts[np.argmax(s)], pts[np.argmax(diff)]],
        dtype=np.float32,
    )


def _detect_quad(image_bgr: np.ndarray) -> np.ndarray | None:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 140)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) < 0.08 * h * w:
        return None
    peri = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
    if len(approx) == 4:
        return _order_quad(approx.reshape(-1, 2))
    rect = cv2.minAreaRect(contour)
    return _order_quad(cv2.boxPoints(rect))


def warp_to_flat(image_bgr: np.ndarray, quad: np.ndarray | None = None) -> np.ndarray | None:
    q = quad if quad is not None else _detect_quad(image_bgr)
    if q is None:
        return None
    dst = np.array(
        [[0, 0], [CANON_W - 1, 0], [CANON_W - 1, CANON_H - 1], [0, CANON_H - 1]],
        dtype=np.float32,
    )
    H = cv2.getPerspectiveTransform(q, dst)
    return cv2.warpPerspective(image_bgr, H, (CANON_W, CANON_H), flags=cv2.INTER_LINEAR)


def _normalize_face(gray: np.ndarray) -> np.ndarray:
    h, w = gray.shape[:2]
    dy, dx = int(h * FACE_TRIM), int(w * FACE_TRIM)
    face = gray[dy : h - dy, dx : w - dx].astype(np.float32)
    mu, sigma = float(face.mean()), float(face.std()) + 1e-6
    norm = (gray.astype(np.float32) - mu) / sigma
    # Map roughly to 0..1 for thresholding.
    return np.clip((norm + 3.0) / 6.0, 0.0, 1.0)


def _grade_from_pct(pct: float, bands: list[tuple[float, int]]) -> int:
    for ceiling, grade in bands:
        if pct <= ceiling:
            return grade
    return 1


def _classify_blob(area: float, length: float, aspect: float) -> tuple[str, str]:
    if length >= MIN_LINE_LEN and aspect >= 3.5:
        if length >= 120:
            return "crease", "Crease across the surface"
        return "scratch", "Scratch on the surface"
    if area >= 120:
        return "dent", "Dent or pit on the surface"
    return "scratch", "Surface mark"


def analyze_tilt_surface(
    flat_bgr: np.ndarray,
    tilt_a_bgr: np.ndarray,
    tilt_b_bgr: np.ndarray,
) -> tuple[TiltSurfaceResult, np.ndarray | None]:
    flat_w = warp_to_flat(flat_bgr)
    a_w = warp_to_flat(tilt_a_bgr)
    b_w = warp_to_flat(tilt_b_bgr)
    if flat_w is None:
        return (
            TiltSurfaceResult(None, False, 0.0, 0.0, reason="Couldn't find the card in the flat photo"),
            None,
        )
    usable = [w for w in (a_w, b_w) if w is not None]
    if len(usable) < 1:
        return (
            TiltSurfaceResult(None, False, 0.0, 0.0, reason="Couldn't find the card in the tilted photos"),
            None,
        )

    flat_n = _normalize_face(cv2.cvtColor(flat_w, cv2.COLOR_BGR2GRAY))
    diffs = []
    for w in usable:
        n = _normalize_face(cv2.cvtColor(w, cv2.COLOR_BGR2GRAY))
        diffs.append(np.abs(n - flat_n))
    # Anomaly strong in at least one tilt.
    stack = np.max(np.stack(diffs, axis=0), axis=0)
    if len(diffs) == 2:
        # Prefer marks that disagree between the two tilts (specular flips).
        disagree = np.abs(diffs[0] - diffs[1])
        stack = np.maximum(stack * 0.65, disagree)
    h, w = stack.shape[:2]
    dy, dx = int(h * FACE_TRIM), int(w * FACE_TRIM)
    roi = np.zeros_like(stack, dtype=np.uint8)
    roi[dy : h - dy, dx : w - dx] = 255
    mask = ((stack >= DIFF_THRESH).astype(np.uint8) * 255) & roi
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

    face_area = float(np.count_nonzero(roi))
    defect_area = float(np.count_nonzero(mask))
    area_pct = 100.0 * defect_area / face_area if face_area else 0.0

    # Lines via Hough on the mask edges.
    edges = cv2.Canny(mask, 50, 150)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=25, minLineLength=MIN_LINE_LEN, maxLineGap=6)
    longest = 0.0
    defects: list[SurfaceDefect] = []
    notes: list[str] = []
    if lines is not None:
        for x1, y1, x2, y2 in lines.reshape(-1, 4):
            length = float(np.hypot(x2 - x1, y2 - y1))
            longest = max(longest, length)
            kind, note = _classify_blob(length, length, 8.0)
            box = [
                min(x1, x2) / CANON_W,
                min(y1, y2) / CANON_H,
                abs(x2 - x1) / CANON_W,
                abs(y2 - y1) / CANON_H,
            ]
            defects.append(SurfaceDefect(kind, length, length, box, note))

    num, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    for i in range(1, num):
        area = float(stats[i, cv2.CC_STAT_AREA])
        if area < MIN_BLOB_AREA:
            continue
        x, y, bw, bh = (stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP],
                        stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT])
        length = float(max(bw, bh))
        aspect = length / max(1.0, float(min(bw, bh)))
        longest = max(longest, length)
        kind, note = _classify_blob(area, length, aspect)
        # Skip if Hough already covered a similar line.
        if kind == "scratch" and any(d.kind == "scratch" and abs(d.length_px - length) < 12 for d in defects):
            continue
        defects.append(
            SurfaceDefect(
                kind,
                length,
                area,
                [x / CANON_W, y / CANON_H, bw / CANON_W, bh / CANON_H],
                note,
            )
        )

    g_area = _grade_from_pct(area_pct, AREA_BANDS)
    g_line = _grade_from_pct(longest, LINE_BANDS)
    score = min(g_area, g_line)
    # Unique user-facing notes.
    for d in sorted(defects, key=lambda d: -d.length_px):
        if d.note not in notes:
            notes.append(d.note)
        if len(notes) >= 5:
            break

    result = TiltSurfaceResult(
        score=score,
        measurable=True,
        defect_area_pct=area_pct,
        longest_line_px=longest,
        defects=defects,
        notes=notes,
        mask_present=True,
    )
    return result, mask
