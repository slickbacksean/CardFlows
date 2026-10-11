"""Card-plane pose from four corners (warp first, then judge the angle).

A phone photo of a flat card taken off-overhead gives a quad whose interior
angles are not 90°, even though perspective correction straightens it
exactly. So instead of rejecting on the raw corner angles, we recover the
homography from the card to the image, factor out a pinhole camera, and read
two things that a warp cannot fix or that reveal a wrong crop:

- ``out_of_plane_deg``: angle between the card's normal and the camera axis.
  Past ~20° foreshortening and focus fall-off make edge/corner detail unreliable.
- ``rectified_aspect``: the true width:height of the detected rectangle once the
  perspective is undone. A real card is 63:88 (0.716). An art window or a text
  panel is not, even when its image quad happens to look card-like.

Focal length: when the caller knows it (EXIF 35 mm equivalent), pass it in.
Otherwise we assume a phone main camera, about 0.75 x the long image side
(26 mm equivalent on a 4:3 sensor). The estimate is insensitive to this for
the mild angles we accept.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

DEFAULT_FOCAL_FRACTION = 0.75


@dataclass(frozen=True)
class PlanePose:
    out_of_plane_deg: float
    rectified_aspect: float  # width / height of the card once rectified


def focal_px_from_35mm(focal_35mm: float, image_shape: tuple[int, ...]) -> float:
    h, w = image_shape[:2]
    return float(focal_35mm) / 36.0 * float(max(h, w))


def estimate_plane_pose(
    corners: np.ndarray,
    image_shape: tuple[int, ...],
    focal_px: float | None = None,
) -> PlanePose:
    """Corners are TL, TR, BR, BL in image pixels."""
    h, w = image_shape[:2]
    f = float(focal_px) if focal_px else DEFAULT_FOCAL_FRACTION * float(max(h, w))
    unit = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype=np.float32)
    homography = cv2.getPerspectiveTransform(unit, np.asarray(corners, dtype=np.float32).reshape(4, 2))
    k_inv = np.linalg.inv(np.array([[f, 0, w / 2.0], [0, f, h / 2.0], [0, 0, 1.0]]))
    m = k_inv @ homography
    h1, h2 = m[:, 0], m[:, 1]
    n1, n2 = float(np.linalg.norm(h1)), float(np.linalg.norm(h2))
    if n1 <= 0 or n2 <= 0:
        return PlanePose(90.0, 0.0)
    normal = np.cross(h1 / n1, h2 / n2)
    norm = float(np.linalg.norm(normal))
    if norm <= 0:
        return PlanePose(90.0, 0.0)
    cos_angle = abs(float(normal[2]) / norm)
    angle = float(np.degrees(np.arccos(np.clip(cos_angle, 0.0, 1.0))))
    return PlanePose(angle, n1 / n2)
