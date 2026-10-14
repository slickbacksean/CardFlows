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

    def test_decoder_already_rotated_is_not_rotated_twice(self):
        import cv2

        import pixel_cap

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "o6.jpg")
            _write_jpeg(path, 6)
            real_imread = cv2.imread

            def rotating_imread(p, flag=cv2.IMREAD_COLOR):
                # Simulate a decoder that applies EXIF even when asked not to.
                return cv2.rotate(real_imread(p, flag), cv2.ROTATE_90_CLOCKWISE)

            cv2.imread = rotating_imread
            try:
                image = pixel_cap.imread_capped(path)
            finally:
                cv2.imread = real_imread
            self.assertEqual(image.shape[:2], (400, 200))
            self.assertGreater(int(image[50, 100][2]), 200)


class PortraitBeforeAspectTest(unittest.TestCase):
    """P0-04: a sideways 63:88 card must hit the aspect check as portrait."""

    def setUp(self):
        from pipeline import detect

        from cardflow_orientation import detect_upright, portrait_corners

        self.detect = detect
        self.detect_upright = detect_upright
        self.portrait_corners = portrait_corners
        self.thresholds = detect.load_thresholds(
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "calibration", "thresholds.json")
        )

    def test_landscape_quad_is_portrait_before_aspect(self):
        # 88x63 landscape rectangle — a 63:88 card on its side.
        corners = np.array([[10.0, 10.0], [98.0, 10.0], [98.0, 73.0], [10.0, 73.0]], dtype=np.float32)
        portrait, rotated = self.portrait_corners(corners)
        self.assertTrue(rotated)
        tl, tr, br, bl = portrait
        width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
        height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
        self.assertLess(width, height)

        seen = {}

        class Module:
            QualityGate = self.detect.QualityGate
            DetectResult = self.detect.DetectResult

            def find_card_contour(this, image):
                return corners.copy()

            def check_resolution(this, image, cfg):
                return self.detect.QualityGate("resolution", True, "ok")

            def check_tilt(this, c, cfg):
                return self.detect.QualityGate("tilt", True, "ok", 0.0)

            def check_aspect_ratio(this, c, cfg, tilt_ok=False):
                seen["tilt_ok"] = tilt_ok
                seen["corners"] = np.array(c, dtype=np.float64)
                return self.detect.check_aspect_ratio(c, cfg, tilt_ok=tilt_ok)

            def perspective_correct(this, image, c, size):
                return np.zeros((size[1], size[0], 3), dtype=np.uint8)

            def detect_glare(this, warped, cfg):
                return self.detect.QualityGate("glare", True, "ok")

            def detect_uneven_lighting(this, warped, cfg):
                return self.detect.QualityGate("uneven_lighting", True, "ok")

        image = np.zeros((120, 160, 3), dtype=np.uint8)
        result, did_rotate = self.detect_upright(image, self.thresholds, Module())
        self.assertTrue(did_rotate)
        tl, tr, br, bl = seen["corners"]
        width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
        height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
        self.assertLess(width, height)
        aspect = next(g for g in result.gates if g.name == "aspect_ratio")
        self.assertTrue(aspect.passed, aspect.detail)
        self.assertLess(aspect.value, 3.0)

    def test_portrait_quad_is_not_rotated(self):
        corners = np.array([[10.0, 10.0], [73.0, 10.0], [73.0, 98.0], [10.0, 98.0]], dtype=np.float32)
        _, rotated = self.portrait_corners(corners)
        self.assertFalse(rotated)

    def test_aspect_tolerances_match_documented_split(self):
        cap = self.thresholds["capture"]
        self.assertEqual(cap["aspect_ratio_tolerance_pct"], 3.0)
        self.assertEqual(cap["aspect_ratio_tolerance_upright_pct"], 8.0)


if __name__ == "__main__":
    unittest.main()

