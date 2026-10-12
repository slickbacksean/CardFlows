"""Warp-first tilt gate: judge the card plane after undoing perspective."""

import sys
import unittest
from pathlib import Path

import cv2
import numpy as np

VENDOR = Path(__file__).resolve().parents[2] / "apps" / "api" / "vendor" / "cardgrading"
sys.path.insert(0, str(VENDOR))

from pipeline.detect import check_corners_in_frame, check_level, check_rectified_aspect, check_tilt, load_thresholds  # noqa: E402
from pipeline.plane import estimate_plane_pose  # noqa: E402

SHAPE = (4032, 3024, 3)
F = 0.75 * 4032


def project(pitch_deg: float, yaw_deg: float, card_w: float = 63.0, card_h: float = 88.0) -> np.ndarray:
    """Pinhole projection of a flat card 250 mm from the camera."""
    p, y = np.radians(pitch_deg), np.radians(yaw_deg)
    rx = np.array([[1, 0, 0], [0, np.cos(p), -np.sin(p)], [0, np.sin(p), np.cos(p)]])
    ry = np.array([[np.cos(y), 0, np.sin(y)], [0, 1, 0], [-np.sin(y), 0, np.cos(y)]])
    pts = np.array([[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]], float) * [card_w / 2, card_h / 2, 0]
    cam = (ry @ rx @ pts.T).T + [15, 10, 150]
    k = np.array([[F, 0, SHAPE[1] / 2], [0, F, SHAPE[0] / 2], [0, 0, 1]])
    uv = (k @ cam.T).T
    return uv[:, :2] / uv[:, 2:]


class WarpFirstTilt(unittest.TestCase):
    def setUp(self) -> None:
        self.cfg = load_thresholds(VENDOR / "calibration" / "thresholds.json")["capture"]

    def test_ten_degree_shot_is_straightened_not_rejected(self) -> None:
        corners = project(10, 5)
        self.assertFalse(check_tilt(corners, self.cfg).passed, "legacy 2° corner rule rejects it")
        gate = check_tilt(corners, self.cfg, SHAPE)
        self.assertTrue(gate.passed)
        self.assertAlmostEqual(gate.value, 11.2, delta=0.6)
        self.assertFalse(check_level(corners, self.cfg).passed)  # soft advisory only

    def test_recovers_true_aspect_under_perspective(self) -> None:
        pose = estimate_plane_pose(project(12, 8), SHAPE, F)
        self.assertAlmostEqual(min(pose.rectified_aspect, 1 / pose.rectified_aspect), 63 / 88, delta=0.003)

    def test_steep_angle_is_rejected(self) -> None:
        self.assertFalse(check_tilt(project(28, 10), self.cfg, SHAPE).passed)

    def test_art_window_shape_fails_rectified_aspect(self) -> None:
        art = project(8, 0, card_w=50.0, card_h=42.0)  # squarish panel, not a card
        self.assertFalse(check_rectified_aspect(art, self.cfg, SHAPE).passed)
        self.assertTrue(check_rectified_aspect(project(8, 0), self.cfg, SHAPE).passed)

    def test_whole_frame_4x3_crop_is_rejected(self) -> None:
        h, w = SHAPE[:2]
        frame = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], float)
        # 3:4 is only ~4.7% off 63:88, so the aspect gate alone can't catch it...
        self.assertTrue(check_rectified_aspect(frame, self.cfg, SHAPE).passed)
        # ...the border gate does.
        self.assertFalse(check_corners_in_frame(frame, self.cfg, SHAPE).passed)
        self.assertTrue(check_corners_in_frame(project(5, 3), self.cfg, SHAPE).passed)

    def test_twenty_degree_boundary(self) -> None:
        for pitch, ok in ((19.0, True), (21.0, False)):
            gate = check_tilt(project(pitch, 0), self.cfg, SHAPE)
            self.assertEqual(gate.passed, ok, f"{pitch}° -> {gate.value:.2f}")
            self.assertAlmostEqual(gate.value, pitch, delta=0.3)


if __name__ == "__main__":
    unittest.main()
