"""Score card outlines against labeled quads (Computer Vision pass bars).

Detection pass bars:
- card found on 98% or more of labeled photos
- quad IoU >= 0.95 on 95% or more
- mean corner error <= 1% of the diagonal, p95 <= 2%
- wrong crop silently accepted on 1% or less   <- the bar that matters most
- good photo sent to retake on 5% or less
Backs and full-art cards are reported as their own slices.

A "wrong crop" is an outline that is accepted (no hard gate failed) but is
not the card: quad IoU below 0.85 against the label (the agreed bar).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

PASS_FOUND_RATE = 0.98
PASS_IOU = 0.95
PASS_IOU_RATE = 0.95
PASS_MEAN_CORNER_ERROR = 0.01
PASS_P95_CORNER_ERROR = 0.02
PASS_WRONG_ACCEPT_RATE = 0.01
PASS_FALSE_RETAKE_RATE = 0.05
WRONG_IOU = 0.85


def polygon_iou(predicted: np.ndarray, truth: np.ndarray) -> float:
    import cv2

    pred = order_corners(predicted).astype(np.float32).reshape(-1, 1, 2)
    gold = order_corners(truth).astype(np.float32).reshape(-1, 1, 2)
    area_pred = abs(float(cv2.contourArea(pred)))
    area_gold = abs(float(cv2.contourArea(gold)))
    if area_pred <= 0 or area_gold <= 0:
        return 0.0
    inter_area, _ = cv2.intersectConvexConvex(pred, gold)
    union = area_pred + area_gold - float(inter_area)
    return float(inter_area) / union if union > 0 else 0.0


def corner_error_fraction(predicted: np.ndarray, truth: np.ndarray) -> float:
    """Mean corner distance divided by the ground-truth diagonal."""
    pred = order_corners(predicted)
    gold = order_corners(truth)
    diagonal = float(np.linalg.norm(gold[2] - gold[0]))
    if diagonal <= 0:
        return 1.0
    return float(np.linalg.norm(pred - gold, axis=1).mean() / diagonal)


def order_corners(points: np.ndarray) -> np.ndarray:
    """TL, TR, BR, BL: clockwise (image coords) around the centroid, starting at min x+y.

    Sorting by angle keeps the order cyclic for any rotation; the sum/diff trick picks
    the same point twice near 45 degrees and makes a self-crossing quad.
    """
    pts = np.asarray(points, dtype=np.float64).reshape(4, 2)
    c = pts.mean(axis=0)
    pts = pts[np.argsort(np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0]))]
    return np.roll(pts, -int(np.argmin(pts.sum(axis=1))), axis=0)


@dataclass(frozen=True)
class SampleScore:
    found: bool
    accepted: bool
    iou: float | None
    corner_error: float | None
    tags: frozenset[str] = field(default_factory=frozenset)
    name: str = ""

    @property
    def correct(self) -> bool:
        return self.found and self.iou is not None and self.iou >= WRONG_IOU

    @property
    def wrong_accept(self) -> bool:
        return self.accepted and not self.correct

    @property
    def false_retake(self) -> bool:
        return self.correct and not self.accepted


def make_sample(name, predicted, accepted, truth, tags=()) -> SampleScore:
    if predicted is None:
        return SampleScore(False, False, None, None, frozenset(tags), name)
    pred = np.asarray(predicted, dtype=np.float64).reshape(4, 2)
    gold = np.asarray(truth, dtype=np.float64).reshape(4, 2)
    return SampleScore(True, bool(accepted), polygon_iou(pred, gold), corner_error_fraction(pred, gold), frozenset(tags), name)


@dataclass(frozen=True)
class Scorecard:
    count: int
    found_rate: float
    iou_rate: float
    mean_corner_error: float | None
    p95_corner_error: float | None
    wrong_accept_rate: float
    wrong_accept_count: int
    false_retake_rate: float
    passes: bool

    def as_dict(self) -> dict:
        return self.__dict__.copy()

    def lines(self, title: str = "all") -> list[str]:
        mean = "n/a" if self.mean_corner_error is None else f"{self.mean_corner_error:.2%}"
        p95 = "n/a" if self.p95_corner_error is None else f"{self.p95_corner_error:.2%}"
        return [
            f"[{title}] samples: {self.count}",
            f"  card found: {self.found_rate:.1%} (bar {PASS_FOUND_RATE:.0%})",
            f"  quad IoU >= {PASS_IOU}: {self.iou_rate:.1%} (bar {PASS_IOU_RATE:.0%})",
            f"  mean corner error: {mean} of diagonal (bar {PASS_MEAN_CORNER_ERROR:.0%})",
            f"  p95 corner error: {p95} (bar {PASS_P95_CORNER_ERROR:.0%})",
            f"  WRONG CROP ACCEPTED: {self.wrong_accept_rate:.1%} ({self.wrong_accept_count}) (bar {PASS_WRONG_ACCEPT_RATE:.0%})",
            f"  good photo sent to retake: {self.false_retake_rate:.1%} (bar {PASS_FALSE_RETAKE_RATE:.0%})",
            f"  result: {('PASS' if self.passes else 'FAIL') if self.count else 'no samples yet'}",
        ]


def score_samples(samples: list[SampleScore]) -> Scorecard:
    count = len(samples)
    if count == 0:
        return Scorecard(0, 0.0, 0.0, None, None, 0.0, 0, 0.0, False)
    found = [s for s in samples if s.found]
    errors = [s.corner_error for s in found if s.corner_error is not None]
    iou_rate = sum(1 for s in found if s.iou is not None and s.iou >= PASS_IOU) / count
    wrong = sum(1 for s in samples if s.wrong_accept)
    correct = [s for s in samples if s.correct]
    false_retake = sum(1 for s in correct if s.false_retake) / max(len(correct), 1)
    mean = float(np.mean(errors)) if errors else None
    p95 = float(np.percentile(errors, 95)) if errors else None
    found_rate = len(found) / count
    passes = (
        found_rate >= PASS_FOUND_RATE
        and iou_rate >= PASS_IOU_RATE
        and mean is not None and mean <= PASS_MEAN_CORNER_ERROR
        and p95 is not None and p95 <= PASS_P95_CORNER_ERROR
        and wrong / count <= PASS_WRONG_ACCEPT_RATE
        and false_retake <= PASS_FALSE_RETAKE_RATE
    )
    return Scorecard(count, found_rate, iou_rate, mean, p95, wrong / count, wrong, false_retake, passes)


SLICES = {"back": lambda tags: "back" in tags, "full-art": lambda tags: "full-art" in tags}


def scorecards(samples: list[SampleScore]) -> dict[str, Scorecard]:
    cards = {"all": score_samples(samples)}
    for name, keep in SLICES.items():
        cards[name] = score_samples([s for s in samples if keep(s.tags)])
    return cards
