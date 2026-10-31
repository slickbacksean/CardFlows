"""
Card localization v2: find the card's actual quadrilateral inside a rough bounding box.

When the client sends only a loose bounding box (Android, and iOS when no quad is available),
the crop may include surrounding objects (e.g. cups, stands). This module finds the card's
actual edges inside that box using classical computer vision.

Algorithm:
1. SSD detection for coarse box (if enabled via SSD model)
2. Classical quad search (Canny + contours) inside a window around the box
3. Fallback: axis-aligned rectangle search for upright cards
4. Sub-pixel edge refinement via RANSAC line fitting

No AGPL code or models.
"""

from __future__ import annotations

import math
from typing import Any

import cv2
import numpy as np
from PIL import Image

# Canonical card crop size (63:88 aspect ratio at 4px/mm)
CARD_W = 250
CARD_H = 350

# Rectangle search minimum score threshold
RS_MIN = 0.62

# Aspect ratio constraints for card detection
MIN_ASPECT = 0.64
MAX_ASPECT = 0.80
CARD_ASPECT = 0.716  # 63/88


def _order_quad(quad: np.ndarray) -> np.ndarray:
    """Re-order quad corners to TL, TR, BR, BL regardless of input order."""
    center = quad.mean(axis=0)
    angles = np.arctan2(quad[:, 1] - center[1], quad[:, 0] - center[0])
    ordered = quad[np.argsort(angles)]
    return ordered


def _quad_ratio(quad: np.ndarray) -> float:
    """Compute aspect ratio (short/long side) of a quadrilateral."""
    a = (np.linalg.norm(quad[1] - quad[0]) + np.linalg.norm(quad[2] - quad[3])) / 2
    b = (np.linalg.norm(quad[3] - quad[0]) + np.linalg.norm(quad[2] - quad[1])) / 2
    return min(a, b) / max(a, b, 1e-6)


def _find_quads(roi: np.ndarray, maxn: int = 8) -> list[dict[str, Any]]:
    """
    Find candidate quadrilaterals in ROI using Canny edge detection and contours.
    Returns list of dicts with 'q' (quad corners), 'fill' (contour fill ratio).
    """
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    
    # Dilate to connect nearby edges
    kernel = np.ones((3, 3), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=1)
    
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    
    candidates = []
    h, w = roi.shape[:2]
    roi_area = w * h
    
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < 0.1 * roi_area or area > 0.9 * roi_area:
            continue
            
        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
        
        if len(approx) == 4 and cv2.isContourConvex(approx):
            quad = approx.reshape(4, 2).astype(np.float32)
            ratio = _quad_ratio(quad)
            if MIN_ASPECT <= ratio <= MAX_ASPECT:
                fill = area / (cv2.boundingRect(contour)[2] * cv2.boundingRect(contour)[3])
                candidates.append({'q': quad, 'fill': fill})
    
    # Sort by fill ratio (higher is better)
    candidates.sort(key=lambda x: x['fill'], reverse=True)
    return candidates[:maxn]


def _edge_refit(image: np.ndarray, quad: np.ndarray, band: float = 0.02) -> np.ndarray:
    """
    Refine quad edges to sub-pixel accuracy via RANSAC line fitting.
    
    For each edge:
    1. Sample points along the edge with perpendicular offsets
    2. Find strongest gradient perpendicular to the edge
    3. RANSAC fit a line to high-gradient points
    4. Intersect adjacent lines to get refined corners
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0).astype(np.float32)
    
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1)
    
    diag = np.linalg.norm(quad[2] - quad[0])
    lines = []
    rng = np.random.default_rng(0)
    
    for i in range(4):
        a, b = quad[i], quad[(i + 1) % 4]
        d = (b - a) / np.linalg.norm(b - a)
        n = np.array([-d[1], d[0]])  # perpendicular
        
        pts = []
        offs = np.arange(-band * diag, band * diag, 0.5)
        
        for t in np.linspace(0.1, 0.9, 40):
            P = (a + (b - a) * t)[None, :] + offs[:, None] * n[None, :]
            xi = np.clip(P[:, 0].astype(int), 0, gray.shape[1] - 1)
            yi = np.clip(P[:, 1].astype(int), 0, gray.shape[0] - 1)
            
            # Gradient strength perpendicular to edge
            m = np.abs(gx[yi, xi] * n[0] + gy[yi, xi] * n[1])
            k = m.argmax()
            
            if m[k] > 30:
                pts.append(P[k])
        
        if len(pts) < 12:
            return quad
        
        pts = np.array(pts, np.float32)
        best_inliers = None
        
        # RANSAC
        for _ in range(150):
            i1, i2 = rng.choice(len(pts), 2, replace=False)
            dd = pts[i2] - pts[i1]
            if np.linalg.norm(dd) < 1:
                continue
            
            nn = np.array([-dd[1], dd[0]]) / np.linalg.norm(dd)
            inliers = np.abs((pts - pts[i1]) @ nn) < 2
            
            if best_inliers is None or inliers.sum() > best_inliers.sum():
                best_inliers = inliers
        
        if best_inliers.sum() < 10:
            return quad
        
        # Fit line to inliers
        vx, vy, x0, y0 = cv2.fitLine(
            pts[best_inliers], cv2.DIST_HUBER, 0, 0.01, 0.01
        ).ravel()
        lines.append((np.array([x0, y0]), np.array([vx, vy])))
    
    # Intersect adjacent lines to get refined corners
    out = []
    for i in range(4):
        (p1, d1), (p2, d2) = lines[i - 1], lines[i]
        try:
            t = np.linalg.solve(np.array([d1, -d2]).T, p2 - p1)
        except np.linalg.LinAlgError:
            return quad
        out.append(p1 + d1 * t[0])
    
    out = np.array(out, np.float32)
    
    # Validate refined quad
    if np.abs(out - quad).max() < band * diag * 1.5:
        ratio = _quad_ratio(out)
        if MIN_ASPECT <= ratio <= MAX_ASPECT:
            return out
    
    return quad


def _rect_search_peaks(profile: np.ndarray, k: int, min_dist: int) -> list[int]:
    """Find k peak positions in a 1D profile, suppressing nearby peaks."""
    p = profile.copy()
    peaks = []
    for _ in range(k):
        i = int(p.argmax())
        if p[i] <= 0:
            break
        peaks.append(i)
        p[max(0, i - min_dist) : i + min_dist + 1] = 0
    return peaks


def _rect_search(roi: np.ndarray, prior_w: float, k: int = 12) -> tuple[float, tuple[int, int, int, int], list[float]] | None:
    """
    Axis-aligned rectangle search for upright cards.
    
    Finds candidate vertical/horizontal edges from gradient profiles,
    then scores all valid rectangles (aspect ratio ~63:88).
    
    Score = fraction of each side's length that sits on a strong perpendicular edge.
    All four sides must have support.
    
    Returns: (score, (left, top, right, bottom), side_scores) or None
    """
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0).astype(np.float32)
    
    gx = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0))
    gy = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1))
    
    thx = np.percentile(gx, 90)
    thy = np.percentile(gy, 90)
    
    # Dilate to make edges more robust
    ex = cv2.dilate((gx > thx).astype(np.uint8), np.ones((1, 5), np.uint8)).astype(np.float32)
    ey = cv2.dilate((gy > thy).astype(np.uint8), np.ones((5, 1), np.uint8)).astype(np.float32)
    
    h, w = gray.shape
    
    # Find candidate x positions (vertical edges)
    cx = _rect_search_peaks(ex.sum(0), k, int(0.02 * w) + 1)
    # Find candidate y positions (horizontal edges)
    ry = _rect_search_peaks(ey.sum(1), k, int(0.02 * h) + 1)
    
    # Cumulative sums for fast range queries
    cx_ex = np.cumsum(ex, axis=0)
    ry_ey = np.cumsum(ey, axis=1)
    
    def vertical_score(x: int, y0: int, y1: int) -> float:
        """Fraction of vertical segment with strong vertical edge."""
        y0, y1 = max(0, y0), min(h - 1, y1)
        return (cx_ex[y1, x] - cx_ex[y0, x]) / max(1, y1 - y0)
    
    def horizontal_score(y: int, x0: int, x1: int) -> float:
        """Fraction of horizontal segment with strong horizontal edge."""
        x0, x1 = max(0, x0), min(w - 1, x1)
        return (ry_ey[y, x1] - ry_ey[y, x0]) / max(1, x1 - x0)
    
    best = None
    
    for left in cx:
        for right in cx:
            width = right - left
            if width < 0.45 * prior_w or width > 1.1 * prior_w:
                continue
            
            for top in ry:
                # Try standard aspect ratios
                for ratio in (0.70, CARD_ASPECT, 0.74):
                    bottom = int(round(top + width / ratio))
                    if bottom >= h:
                        continue
                    
                    # Allow bottom to snap to a nearby strong row (±3% of height)
                    candidates = [bottom] + [
                        y for y in ry if abs(y - bottom) < 0.03 * width / ratio
                    ]
                    
                    for bb in candidates:
                        scores = [
                            vertical_score(left, top, bb),
                            vertical_score(right, top, bb),
                            horizontal_score(top, left, right),
                            horizontal_score(bb, left, right),
                        ]
                        
                        # Combined score: min + mean + width bonus
                        score = (
                            min(scores) * 0.5
                            + np.mean(scores) * 0.5
                            + 0.25 * min(1.0, width / (0.85 * prior_w))
                        )
                        
                        if best is None or score > best[0]:
                            best = (score, (left, top, right, bb), scores)
    
    return best


def localize_card(
    image: Image.Image, box: tuple[float, float, float, float] | None = None
) -> dict[str, Any]:
    """
    Localize card within image, optionally inside a bounding box.
    
    Args:
        image: PIL Image
        box: Optional bounding box (x0, y0, x1, y1) to search within
    
    Returns:
        dict with:
            - quad: np.ndarray of shape (4, 2) or None if failed
            - method: 'quad' | 'rect' | 'fallback' | 'fail'
            - box: the bounding box used
            - conf: detection confidence (if available)
            - rs_score: rect search score (if method='rect')
    """
    rgb = np.asarray(image.convert("RGB"))
    h, w = rgb.shape[:2]
    
    # If no box provided, use whole image
    if box is None:
        box = (0, 0, w, h)
    
    x0, y0, x1, y1 = box
    box_w, box_h = x1 - x0, y1 - y0
    
    # Expand search region by 12% horizontally, 12% top, 5% bottom
    search_x0 = int(max(0, x0 - 0.12 * box_w))
    search_y0 = int(max(0, y0 - 0.12 * box_h))
    search_x1 = int(min(w, x1 + 0.12 * box_w))
    search_y1 = int(min(h, y1 + 0.05 * box_h))
    
    roi = rgb[search_y0:search_y1, search_x0:search_x1]
    
    # Try quad detection first
    quads = _find_quads(roi, maxn=8)
    
    best_quad = None
    for candidate in quads:
        q = _order_quad(candidate['q']) + np.array([search_x0, search_y0], np.float32)
        ratio = _quad_ratio(q)
        
        if not (0.66 <= ratio <= 0.80):
            continue
        
        # Check that quad width spans most of the coarse width
        qw = np.linalg.norm(q[1] - q[0])
        if qw < 0.55 * box_w:
            continue
        
        # Check that quad center is inside the original box
        cx, cy = q.mean(0)
        if not (x0 < cx < x1 and y0 < cy < y1):
            continue
        
        # Score by fill + aspect match
        score = candidate['fill'] - abs(ratio - CARD_ASPECT)
        
        if best_quad is None or score > best_quad[0]:
            best_quad = (score, q)
    
    if best_quad is not None:
        quad = _edge_refit(rgb, best_quad[1])
        return {
            'quad': quad,
            'method': 'quad',
            'box': box,
            'conf': None,
        }
    
    # Fallback: axis-aligned rectangle search
    result = _rect_search(roi, box_w)
    
    if result is not None and result[0] >= RS_MIN:
        score, (left, top, right, bottom), side_scores = result
        quad = np.array(
            [
                [left, top],
                [right, top],
                [right, bottom],
                [left, bottom],
            ],
            np.float32,
        ) + np.array([search_x0, search_y0], np.float32)
        
        quad = _edge_refit(rgb, quad, band=0.01)
        
        return {
            'quad': quad,
            'method': 'rect',
            'box': box,
            'conf': None,
            'rs_score': score,
        }
    
    # Failed to localize
    return {
        'quad': None,
        'method': 'fail',
        'box': box,
        'conf': None,
        'rs_score': result[0] if result else None,
    }


def warp_localized(image: Image.Image, quad: np.ndarray) -> Image.Image:
    """
    Warp a localized quad to canonical card size (250x350).
    
    Args:
        image: PIL Image
        quad: np.ndarray of shape (4, 2) with corners [TL, TR, BR, BL]
    
    Returns:
        Warped PIL Image of size (250, 350)
    """
    rgb = np.asarray(image.convert("RGB"))
    
    # Check if card is landscape (rotate corner order)
    top_edge = np.linalg.norm(quad[1] - quad[0])
    side_edge = np.linalg.norm(quad[3] - quad[0])
    
    if top_edge > side_edge:
        quad = np.roll(quad, -1, axis=0)
    
    dst = np.array(
        [[0, 0], [CARD_W, 0], [CARD_W, CARD_H], [0, CARD_H]], dtype=np.float32
    )
    
    matrix = cv2.getPerspectiveTransform(quad.astype(np.float32), dst)
    out = cv2.warpPerspective(
        rgb, matrix, (CARD_W, CARD_H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
    )
    
    return Image.fromarray(out)
