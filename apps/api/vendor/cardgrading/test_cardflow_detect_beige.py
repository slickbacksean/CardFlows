"""CardFlow regression: a light card on a beige table (Sean's iPhone photos, Oct 2026).

The clean, square-on front photo used to come back as a skewed quad around the
artwork only (tilt 12 deg -> "Hold the phone flat over the card"). The edge
candidates in find_card_contour must find the whole card, upright.
Run: python -m unittest apps/api/vendor/cardgrading/test_cardflow_detect_beige.py
"""

import sys
import unittest
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from pipeline import detect  # noqa: E402
from cardflow_orientation import detect_upright  # noqa: E402

THRESHOLDS = detect.load_thresholds(ROOT / "calibration" / "thresholds.json")


def gate(result, name):
    return next(g for g in result.gates if g.name == name)


class BeigeTableTest(unittest.TestCase):
    def check_whole_card(self, image, card_w, card_h):
        result, _ = detect_upright(image, THRESHOLDS, detect)
        self.assertIsNotNone(result.contour)
        self.assertTrue(gate(result, "tilt").passed, gate(result, "tilt").detail)
        self.assertTrue(gate(result, "aspect_ratio").passed, gate(result, "aspect_ratio").detail)
        tl, tr, br, bl = result.contour
        width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
        height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
        # Whole card, not just the artwork box.
        self.assertGreater(width, 0.9 * card_w)
        self.assertGreater(height, 0.9 * card_h)
        self.assertIsNotNone(result.warped)

    def test_clean_front_on_beige_is_upright_and_cropped(self):
        image = cv2.imread(str(ROOT / "testdata" / "beige-clean.jpg"))
        self.check_whole_card(image, 460, 640)

    def test_clean_front_at_phone_resolution(self):
        image = cv2.imread(str(ROOT / "testdata" / "beige-clean.jpg"))
        big = cv2.resize(image, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
        self.check_whole_card(big, 3 * 460, 3 * 640)

    def test_blurry_front_still_finds_card(self):
        image = cv2.imread(str(ROOT / "testdata" / "beige-blurry.jpg"))
        self.check_whole_card(image, 760, 1040)


    def test_edge_candidates_must_be_card_shaped(self):
        def box(w, h):
            return np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)
        self.assertTrue(detect._card_shaped(box(630, 880)))   # 0.716 portrait
        self.assertTrue(detect._card_shaped(box(880, 630)))   # 1.397 landscape
        self.assertFalse(detect._card_shaped(box(300, 1020)))  # 3.4:1 strip
        self.assertFalse(detect._card_shaped(box(800, 800)))   # square

    def test_sharpness_is_not_measured_above_the_card_resolution(self):
        from cardflow_capture_checks import sharpness
        rng = np.random.default_rng(1)
        card = (rng.random((700, 500)) * 255).astype(np.uint8)  # 500 px wide card, sharp texture
        warp = cv2.resize(card, (1500, 2100), interpolation=cv2.INTER_LINEAR)  # canonical upscale
        self.assertGreater(sharpness(warp, 500), 2 * sharpness(warp))


if __name__ == "__main__":
    unittest.main()
