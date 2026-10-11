"""CardFlow card finder: mask model -> quad -> edge refinement -> confidence.

Runs on the full-res still on the server (ONNX Runtime, MIT). Returns virtual
corners in the shared convention (INTERFACE.md). The same ONNX weights are the
source for the on-device export (step 3).
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
VENDOR = HERE.parents[1] / "apps" / "api" / "vendor" / "cardgrading"
if str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

from label_assist import refine  # noqa: E402
from score import order_corners  # noqa: E402

MODEL_PATH = HERE / "models" / "card-finder.onnx"
VERSION = "card-finder@0.1.0"
SIZE = 256
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)
ACCEPT_THRESHOLD = 0.80  # calibrated on the test set; see scorecards/
EDGE_MARGIN_FRACTION = 0.005


@dataclass(frozen=True)
class FoundCard:
    corners: np.ndarray  # (4, 2) TL, TR, BR, BL virtual corners, full-res pixels
    confidence: float
    confident: bool
    reject_reasons: tuple[str, ...]


def upright_order(quad: np.ndarray) -> np.ndarray:
    """TL, TR, BR, BL with the long side vertical (a sideways card is rotated, not squashed)."""
    q = order_corners(quad)
    w = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2
    h = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2
    if w > h:
        q = np.roll(q, -1, axis=0)  # TR becomes TL of the upright card
    return q


def fit_quad(mask: np.ndarray) -> np.ndarray | None:
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    if cv2.contourArea(c) < 0.004 * mask.size:
        return None
    hull = cv2.convexHull(c)
    peri = cv2.arcLength(hull, True)
    for eps in np.linspace(0.01, 0.08, 15):
        approx = cv2.approxPolyDP(hull, eps * peri, True)
        if len(approx) == 4:
            return approx.reshape(4, 2).astype(np.float64)
    return cv2.boxPoints(cv2.minAreaRect(c)).astype(np.float64)


class CardFinder:
    def __init__(self, session):
        self.session = session

    @classmethod
    def load(cls, path: Path = MODEL_PATH) -> "CardFinder":
        import onnxruntime as ort

        return cls(ort.InferenceSession(str(path), providers=["CPUExecutionProvider"]))

    def mask(self, image: np.ndarray) -> np.ndarray:
        """Card probability map at image resolution / (long side / SIZE)."""
        h, w = image.shape[:2]
        s = SIZE / max(h, w)
        nh, nw = int(round(h * s)), int(round(w * s))
        y0, x0 = (SIZE - nh) // 2, (SIZE - nw) // 2
        canvas = np.zeros((SIZE, SIZE, 3), np.uint8)
        canvas[y0:y0 + nh, x0:x0 + nw] = cv2.resize(image, (nw, nh), interpolation=cv2.INTER_AREA)
        x = ((canvas[..., ::-1].astype(np.float32) / 255 - MEAN) / STD).transpose(2, 0, 1)[None]
        logits = self.session.run(None, {"image": x})[0][0, 0]
        prob = 1 / (1 + np.exp(-logits))
        return prob[y0:y0 + nh, x0:x0 + nw]

    def find(self, image: np.ndarray) -> FoundCard | None:
        h, w = image.shape[:2]
        prob = self.mask(image)
        binary = prob > 0.5
        coarse = fit_quad(binary)
        if coarse is None:
            return None
        scale = np.array([w / prob.shape[1], h / prob.shape[0]])
        coarse_full = coarse * scale
        reasons: list[str] = []
        try:
            quad = refine(image, coarse_full, band=0.02)
            quad = refine(image, quad, band=0.007)
            # refinement must stay close to the model's outline
            drift = np.linalg.norm(order_corners(quad) - order_corners(coarse_full), axis=1).max() / np.hypot(h, w)
            if not np.isfinite(quad).all() or drift > 0.03:
                quad = coarse_full
                reasons.append("edge_refine_failed")
        except (np.linalg.LinAlgError, ValueError, cv2.error):
            quad = coarse_full
            reasons.append("edge_refine_failed")
        quad = upright_order(quad)
        # confidence: the mask agrees with the quad, and the mask is decisive inside/outside
        poly = np.zeros(prob.shape, np.uint8)
        cv2.fillPoly(poly, [np.round(quad / scale).astype(np.int32)], 1)
        inter = float((binary & (poly > 0)).sum())
        union = float((binary | (poly > 0)).sum())
        agreement = inter / union if union else 0.0
        inside = float(prob[poly > 0].mean()) if poly.any() else 0.0
        outside_band = cv2.dilate(poly, np.ones((7, 7), np.uint8)) - poly
        outside = float(prob[outside_band > 0].mean()) if outside_band.any() else 1.0
        confidence = float(np.clip(agreement * inside * (1 - outside), 0, 1))
        margin = EDGE_MARGIN_FRACTION * max(h, w)
        if (quad[:, 0] < margin).any() or (quad[:, 1] < margin).any() or (quad[:, 0] > w - margin).any() or (quad[:, 1] > h - margin).any():
            reasons.append("corner_cut_off")
        if confidence < ACCEPT_THRESHOLD:
            reasons.append("low_confidence")
        confident = confidence >= ACCEPT_THRESHOLD and "corner_cut_off" not in reasons
        return FoundCard(quad, confidence, confident, tuple(reasons))


def gate_quad(corners: np.ndarray, image_shape, thresholds: dict) -> bool:
    from pipeline.detect import check_rectified_aspect, check_tilt

    cfg = thresholds["capture"]
    return check_tilt(corners, cfg, image_shape).passed and check_rectified_aspect(corners, cfg, image_shape).passed
