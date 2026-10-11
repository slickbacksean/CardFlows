"""CardFlow local test: EXIF orientation is applied before detect.

Run: python -m unittest apps/api/vendor/cardgrading/test_pixel_cap.py
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from pixel_cap import imread_capped  # noqa: E402


def _write_jpeg(path, orientation):
    # 400x200 landscape: left half red, right half blue.
    pixels = np.zeros((200, 400, 3), dtype=np.uint8)
    pixels[:, :200] = (255, 0, 0)
    pixels[:, 200:] = (0, 0, 255)
    exif = Image.Exif()
    exif[0x0112] = orientation
    Image.fromarray(pixels, "RGB").save(path, "JPEG", quality=95, exif=exif)


class OrientationTest(unittest.TestCase):
    def test_orientation_6_is_rotated_upright(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "o6.jpg")
            _write_jpeg(path, 6)
            image = imread_capped(path)
            self.assertEqual(image.shape[:2], (400, 200))
            # Rotated 90 deg clockwise: stored left (red) ends on top. BGR order.
            top = image[50, 100]
            bottom = image[350, 100]
            self.assertGreater(int(top[2]), 200)
            self.assertLess(int(top[0]), 60)
            self.assertGreater(int(bottom[0]), 200)
            self.assertLess(int(bottom[2]), 60)

    def test_orientation_1_is_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "o1.jpg")
            _write_jpeg(path, 1)
            self.assertEqual(imread_capped(path).shape[:2], (200, 400))

    def test_orientation_6_with_reduced_decode(self):
        os.environ["CARDFLOW_GRADE_MAX_PIXELS"] = "10000"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                path = os.path.join(tmp, "o6.jpg")
                _write_jpeg(path, 6)
                height, width = imread_capped(path).shape[:2]
                self.assertGreater(height, width)
        finally:
            del os.environ["CARDFLOW_GRADE_MAX_PIXELS"]


if __name__ == "__main__":
    unittest.main()
