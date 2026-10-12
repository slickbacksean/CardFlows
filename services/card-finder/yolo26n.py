"""Test-only YOLO26n A/B baseline for card-finder eval.

Returns (corners, accepted) in the shared CardQuad convention:
TL, TR, BR, BL in source-image pixels, origin top-left.

AGPL-gated. Not for production or App Store. Requires
CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true and CARD_FLOW_YOLO26N_ONDEVICE=true.

TODO(ship): Replace YOLO26n (Ultralytics AGPL-3.0) or buy an Ultralytics
Enterprise license before App Store / production ship.
"""

from __future__ import annotations

import os
import sys
from typing import Any

import numpy as np

YOLO26N_SOURCE = "yolo26n-ab"
YOLO26N_SOURCE_VERSION = "yolo26n-ab@pre-ship"
CARD_ASPECT = 63 / 88
MIN_SHORT_OVER_LONG = 0.60
MAX_SHORT_OVER_LONG = 0.82
MIN_FILL = 0.10
MIN_CONF = 0.25
SHIP_BLOCKED = frozenset({"production", "store", "app-store", "appstore"})


def pre_ship_allowed(env: dict[str, str] | None = None) -> bool:
    values = env if env is not None else os.environ
    profile = values.get("EAS_BUILD_PROFILE", "").strip().lower()
    if profile in SHIP_BLOCKED:
        return False
    agpl = values.get("CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED", "").strip().lower() == "true"
    opt_in = values.get("CARD_FLOW_YOLO26N_ONDEVICE", "").strip().lower() == "true"
    return agpl and opt_in


def require_pre_ship(env: dict[str, str] | None = None) -> None:
    if pre_ship_allowed(env):
        return
    print(
        "YOLO26n eval is test-only. Set CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true "
        "and CARD_FLOW_YOLO26N_ONDEVICE=true. Blocked on production / store EAS profiles.",
        file=sys.stderr,
    )
    raise SystemExit(2)


def corners_from_xyxy(x1: float, y1: float, x2: float, y2: float) -> np.ndarray:
    """Axis-aligned box → TL, TR, BR, BL."""
    return np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float64)


def corners_from_xywhr(cx: float, cy: float, width: float, height: float, radians: float) -> np.ndarray:
    """YOLO OBB xywhr → four corners, then ordered TL, TR, BR, BL of the upright card."""
    hw, hh = width / 2.0, height / 2.0
    local = np.array([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], dtype=np.float64)
    cos_a, sin_a = float(np.cos(radians)), float(np.sin(radians))
    rot = np.array([[cos_a, -sin_a], [sin_a, cos_a]], dtype=np.float64)
    pts = local @ rot.T + np.array([cx, cy], dtype=np.float64)
    return order_tl_tr_br_bl(pts)


def order_tl_tr_br_bl(points: np.ndarray) -> np.ndarray:
    pts = np.asarray(points, dtype=np.float64).reshape(4, 2)
    ordered = np.zeros((4, 2), dtype=np.float64)
    total = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).reshape(-1)
    ordered[0] = pts[np.argmin(total)]
    ordered[2] = pts[np.argmax(total)]
    ordered[1] = pts[np.argmin(diff)]
    ordered[3] = pts[np.argmax(diff)]
    return ordered


def card_like(width: float, height: float, frame_w: int, frame_h: int) -> bool:
    if width <= 0 or height <= 0 or frame_w <= 0 or frame_h <= 0:
        return False
    fill = (width * height) / (frame_w * frame_h)
    if fill < MIN_FILL:
        return False
    shortest, longest = min(width, height), max(width, height)
    ratio = shortest / longest
    return MIN_SHORT_OVER_LONG <= ratio <= MAX_SHORT_OVER_LONG


def card_quad(
    corners: np.ndarray,
    image_width: int,
    image_height: int,
    confidence: float,
    accepted: bool,
    reject_reasons: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "version": 1,
        "source": YOLO26N_SOURCE,
        "sourceVersion": YOLO26N_SOURCE_VERSION,
        "imageWidth": image_width,
        "imageHeight": image_height,
        "corners": [[float(x), float(y)] for x, y in corners.reshape(4, 2)],
        "confidence": float(confidence),
        "accepted": bool(accepted),
        "outOfPlaneDeg": None,
        "rejectReasons": list(reject_reasons or []),
    }


def _pick_from_result(result: Any, frame_w: int, frame_h: int) -> tuple[np.ndarray, float] | None:
    obb = getattr(result, "obb", None)
    if obb is not None and getattr(obb, "xywhr", None) is not None and len(obb) > 0:
        xywhr = obb.xywhr.cpu().numpy()
        confs = obb.conf.cpu().numpy() if getattr(obb, "conf", None) is not None else np.ones(len(xywhr))
        best = None
        best_conf = MIN_CONF
        for row, conf in zip(xywhr, confs):
            if float(conf) < best_conf:
                continue
            if not card_like(float(row[2]), float(row[3]), frame_w, frame_h):
                continue
            best = corners_from_xywhr(float(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[4]))
            best_conf = float(conf)
        return (best, best_conf) if best is not None else None

    boxes = getattr(result, "boxes", None)
    if boxes is None or len(boxes) == 0:
        return None
    xyxy = boxes.xyxy.cpu().numpy()
    confs = boxes.conf.cpu().numpy() if getattr(boxes, "conf", None) is not None else np.ones(len(xyxy))
    best = None
    best_conf = MIN_CONF
    for row, conf in zip(xyxy, confs):
        if float(conf) < best_conf:
            continue
        x1, y1, x2, y2 = (float(v) for v in row[:4])
        if not card_like(x2 - x1, y2 - y1, frame_w, frame_h):
            continue
        best = corners_from_xyxy(x1, y1, x2, y2)
        best_conf = float(conf)
    return (best, best_conf) if best is not None else None


def run_yolo26n(image, weights: str | None = None) -> tuple[np.ndarray | None, bool]:
    """Eval runner: (corners TL-TR-BR-BL, accepted). None when no card-like box."""
    require_pre_ship()
    try:
        from ultralytics import YOLO
    except ImportError:
        print("Install Ultralytics in a gitignored venv. Do not vendor it into apps/.", file=sys.stderr)
        raise SystemExit(1)
    model = YOLO(weights or os.environ.get("CARD_FLOW_YOLO26N_WEIGHTS") or "yolo26n.pt")
    frame_h, frame_w = image.shape[:2]
    results = model.predict(image, imgsz=640, verbose=False)
    if not results:
        return None, False
    picked = _pick_from_result(results[0], frame_w, frame_h)
    if picked is None:
        return None, False
    corners, confidence = picked
    return corners, confidence >= MIN_CONF
