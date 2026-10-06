"""CardFlow local addition: cap decoded photo size before grading.

Grader memory scales with pixel count (~1 GB at 12 MP), so a 48-50 MP phone photo
could exhaust a 2 GB instance. `imread_capped` reads the dimensions from the file
header first (Pillow opens lazily, without decoding pixels) and, for large photos,
asks OpenCV for a 1/2, 1/4 or 1/8 reduced decode, so the full-size bitmap is never
allocated. Whatever is still above CARDFLOW_GRADE_MAX_PIXELS (default 16 MP) is then
downscaled with INTER_AREA, keeping the aspect ratio.
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


def header_size(path):
    """(width, height) from the image header without decoding pixels, or None."""
    try:
        import warnings

        from PIL import Image

        # Header-only read: lift Pillow's bomb guard so huge photos still report a size
        # (and get the reduced decode) instead of falling back to a full decode.
        Image.MAX_IMAGE_PIXELS = None
        with warnings.catch_warnings():
            # Only the header is read here; large sizes are handled by the reduced decode.
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                return image.size
    except Exception:
        return None


def imread_capped(path):
    import cv2

    size = header_size(path)
    flag = cv2.IMREAD_COLOR
    if size:
        pixels = size[0] * size[1]
        limit = max_pixels()
        for factor, reduced in ((8, cv2.IMREAD_REDUCED_COLOR_8), (4, cv2.IMREAD_REDUCED_COLOR_4), (2, cv2.IMREAD_REDUCED_COLOR_2)):
            # Largest reduction that still leaves at least the pixel limit to work with.
            if pixels / (factor * factor) >= limit:
                flag = reduced
                break
    return cap_pixels(cv2.imread(str(path), flag))
