"""CardFlow local addition: cap decoded photo size before grading.

Grader memory scales with pixel count (~1 GB at 12 MP), so a 48-50 MP phone photo
could exhaust a 2 GB instance. Anything above CARDFLOW_GRADE_MAX_PIXELS (default
16 MP) is downscaled with INTER_AREA, keeping the aspect ratio.
"""
from __future__ import annotations

import math
import os

DEFAULT_MAX_PIXELS = 16_000_000


def max_pixels() -> int:
    raw = os.environ.get("CARDFLOW_GRADE_MAX_PIXELS", "").strip()
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_MAX_PIXELS
    return value if value > 0 else DEFAULT_MAX_PIXELS


def cap_pixels(image):
    if image is None:
        return image
    height, width = image.shape[:2]
    limit = max_pixels()
    if width * height <= limit:
        return image
    import cv2

    scale = math.sqrt(limit / float(width * height))
    size = (max(1, int(width * scale)), max(1, int(height * scale)))
    return cv2.resize(image, size, interpolation=cv2.INTER_AREA)
