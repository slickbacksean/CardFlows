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
VERSION = "card-finder@0.3.0"
SIZE = 256
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)
ASPECT_SCALE = 0.12  # aspect error at which confidence reaches 0
THRESHOLD_PATH = HERE / "models" / "card-finder.threshold.json"


def _accept_threshold() -> float:
    """Fit on the held-out synthetic validation split by train/calibrate.py, never on baseline/test photos."""
    import json

    try:
        return float(json.loads(THRESHOLD_PATH.read_text())["accept_threshold"])
    except (OSError, ValueError, KeyError):
        return 0.80


ACCEPT_THRESHOLD = _accept_threshold()
EDGE_MARGIN_FRACTION = 0.005


@dataclass(frozen=True)
class FoundCard:
    corners: np.ndarray  # (4, 2) TL, TR, BR, BL virtual corners, full-res pixels
    confidence: float
    confident: bool
    reject_reasons: tuple[str, ...]
    features: dict | None = None


CONFIDENCE_PATH = HERE / "models" / "card-finder.confidence.json"
FEATURES = ("agreement", "outside", "aspect_err", "inner", "refine_failed", "area", "largest_share")


def confidence_features(prob, binary, quad, scale, image_shape, reasons) -> dict:
    poly = np.zeros(prob.shape, np.uint8)
    cv2.fillPoly(poly, [np.round(quad / scale).astype(np.int32)], 1)
    inter = float((binary & (poly > 0)).sum())
    union = float((binary | (poly > 0)).sum())
    ring = cv2.dilate(poly, np.ones((13, 13), np.uint8)) - cv2.dilate(poly, np.ones((5, 5), np.uint8))
    inner = cv2.erode(poly, np.ones((5, 5), np.uint8))
    try:
        from pipeline.plane import estimate_plane_pose

        aspect_err = abs(estimate_plane_pose(quad, image_shape).rectified_aspect / (63 / 88) - 1)
    except (np.linalg.LinAlgError, ValueError):
        aspect_err = 1.0
    n, labels, stats, _ = cv2.connectedComponentsWithStats(binary.astype(np.uint8))
    areas = stats[1:, cv2.CC_STAT_AREA] if n > 1 else np.array([0])
    return {
        "agreement": inter / union if union else 0.0,
        "outside": float(prob[ring > 0].mean()) if ring.any() else 1.0,
        "aspect_err": float(min(aspect_err, 1.0)),
        "inner": float(prob[inner > 0].mean()) if inner.any() else 0.0,
        "refine_failed": float("edge_refine_failed" in reasons),
        "area": float(poly.mean()),
        "largest_share": float(areas.max() / max(1, areas.sum())),
    }


def _load_confidence_weights():
    import json

    try:
        d = json.loads(CONFIDENCE_PATH.read_text())
        return np.array([d["weights"][k] for k in FEATURES]), float(d["bias"])
    except (OSError, ValueError, KeyError):
        return None


_WEIGHTS = _load_confidence_weights()


def score_confidence(f: dict) -> float:
    """Logistic model fit by train/fit_confidence.py; heuristic fallback if absent."""
    if _WEIGHTS is not None:
        w, b = _WEIGHTS
        z = float(np.dot(w, [f[k] for k in FEATURES]) + b)
        return float(1 / (1 + np.exp(-z)))
    return float(np.clip(f["agreement"] * (1 - f["outside"]) * max(0.0, 1 - f["aspect_err"] / ASPECT_SCALE), 0, 1))


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
            convex = np.isfinite(quad).all() and cv2.isContourConvex(np.round(order_corners(quad)).astype(np.int32).reshape(-1, 1, 2))
            if not convex or drift > 0.03:
                quad = coarse_full
                reasons.append("edge_refine_failed")
        except (np.linalg.LinAlgError, ValueError, cv2.error):
            quad = coarse_full
            reasons.append("edge_refine_failed")
        quad = upright_order(quad)
        features = confidence_features(prob, binary, quad, scale, image.shape, reasons)
        confidence = score_confidence(features)
        margin = EDGE_MARGIN_FRACTION * max(h, w)
        if (quad[:, 0] < margin).any() or (quad[:, 1] < margin).any() or (quad[:, 0] > w - margin).any() or (quad[:, 1] > h - margin).any():
            reasons.append("corner_cut_off")
        if confidence < ACCEPT_THRESHOLD:
            reasons.append("low_confidence")
        confident = confidence >= ACCEPT_THRESHOLD and "corner_cut_off" not in reasons
        return FoundCard(quad, confidence, confident, tuple(reasons), features)


def gate_quad(corners: np.ndarray, image_shape, thresholds: dict) -> bool:
    from pipeline.detect import check_rectified_aspect, check_tilt

    cfg = thresholds["capture"]
    return check_tilt(corners, cfg, image_shape).passed and check_rectified_aspect(corners, cfg, image_shape).passed
