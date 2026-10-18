"""Unit tests for full-grade corner close-up + tilt surface (classical OpenCV)."""
from __future__ import annotations
import unittest
import cv2
import numpy as np
from cardflow_corner_closeup import analyze_corner_closeup, combine_corner_scores
from cardflow_extra_blur import check_extra_blur
from cardflow_tilt_surface import analyze_tilt_surface, warp_to_flat


def _card(w=320, h=448, border=28, face=40, border_color=(30, 80, 160)):
    img = np.full((h, w, 3), 200, np.uint8)
    img[border : h - border, border : w - border] = border_color
    img[border + 18 : h - border - 18, border + 18 : w - border - 18] = (face, face + 20, face + 40)
    return img


def _whiten_corner(img, corner="tl", band=10, border=28):
    out = img.copy()
    h, w = out.shape[:2]
    if corner == "tl":
        out[border : border + band, border : border + band * 4] = 245
        out[border : border + band * 4, border : border + band] = 245
    return out


def _scratch(img, y=200):
    out = img.copy()
    cv2.line(out, (60, y), (260, y + 8), (220, 220, 220), 2)
    return out


class TestBlur(unittest.TestCase):
    def test_sharp_vs_blurry(self):
        sharp = _card()
        noise = (np.random.default_rng(0).random(sharp.shape) * 40).astype(np.uint8)
        sharp = cv2.add(sharp, noise)
        blurry = cv2.GaussianBlur(sharp, (31, 31), 0)
        self.assertTrue(check_extra_blur(sharp)["ok"])
        self.assertFalse(check_extra_blur(blurry)["ok"])


class TestCornerCloseup(unittest.TestCase):
    def test_clean_scores_high(self):
        result = analyze_corner_closeup(_card(), "tl")
        self.assertTrue(result.measurable)
        self.assertGreaterEqual(result.score, 8)

    def test_whitened_scores_lower(self):
        clean = analyze_corner_closeup(_card(), "tl")
        worn = analyze_corner_closeup(_whiten_corner(_card(), "tl"), "tl")
        self.assertTrue(worn.measurable)
        self.assertLessEqual(worn.score, clean.score)
        self.assertLessEqual(worn.score, 8)
        self.assertIsNotNone(worn.note)

    def test_combine_advisory_unless_high_confidence(self):
        # Without high_confidence, close-up never lowers the flat grade.
        self.assertEqual(combine_corner_scores(9, 6), 9)
        self.assertEqual(combine_corner_scores(9, 6, high_confidence=False), 9)
        self.assertEqual(combine_corner_scores(9, None), 9)
        self.assertIsNone(combine_corner_scores(None, 4, high_confidence=True))
        self.assertIsNone(combine_corner_scores(None, None))
        # High confidence: lower by at most 1 point.
        self.assertEqual(combine_corner_scores(9, 6, high_confidence=True), 8)
        self.assertEqual(combine_corner_scores(9, 8, high_confidence=True), 8)
        self.assertEqual(combine_corner_scores(9, 9, high_confidence=True), 9)
        self.assertEqual(combine_corner_scores(5, 1, high_confidence=True), 4)

    def test_whitened_note_is_advisory(self):
        worn = analyze_corner_closeup(_whiten_corner(_card(), "tl"), "tl")
        self.assertTrue(worn.note and worn.note.startswith("Possible"))


class TestTiltSurface(unittest.TestCase):
    def test_warp_finds_card(self):
        self.assertIsNotNone(warp_to_flat(_card()))

    def test_scratch_lowers_score(self):
        flat = _card()
        texture = (np.random.default_rng(1).random(flat.shape) * 15).astype(np.uint8)
        flat = cv2.add(flat, texture)
        clean_tilt = flat.copy()
        scratched = cv2.convertScaleAbs(_scratch(flat), alpha=1.05, beta=8)
        clean_result, _ = analyze_tilt_surface(flat, clean_tilt, clean_tilt)
        bad_result, mask = analyze_tilt_surface(flat, scratched, clean_tilt)
        self.assertTrue(bad_result.measurable and clean_result.measurable)
        self.assertLessEqual(bad_result.score, clean_result.score)
        self.assertIsNotNone(mask)


if __name__ == "__main__":
    unittest.main()
