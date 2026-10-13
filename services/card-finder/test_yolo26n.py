"""Unit tests for the test-only YOLO26n eval runner. No Ultralytics import required."""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from yolo26n import (  # noqa: E402
    YOLO26N_SOURCE,
    card_like,
    card_quad,
    corners_from_xywhr,
    corners_from_xyxy,
    pre_ship_allowed,
    require_pre_ship,
)


class Yolo26nRunnerTests(unittest.TestCase):
    def test_source_is_yolo26n_ab(self) -> None:
        corners = corners_from_xyxy(10, 20, 110, 220)
        quad = card_quad(corners, 640, 480, 0.9, True)
        self.assertEqual(quad["source"], "yolo26n-ab")
        self.assertEqual(quad["source"], YOLO26N_SOURCE)
        self.assertEqual(quad["version"], 1)
        self.assertEqual(quad["corners"], [[10.0, 20.0], [110.0, 20.0], [110.0, 220.0], [10.0, 220.0]])

    def test_obb_corners_are_ordered_tl_tr_br_bl(self) -> None:
        pts = corners_from_xywhr(50, 50, 40, 20, math.radians(0))
        self.assertAlmostEqual(pts[0, 0], 30)
        self.assertAlmostEqual(pts[0, 1], 40)
        self.assertAlmostEqual(pts[1, 0], 70)
        self.assertAlmostEqual(pts[2, 0], 70)
        self.assertAlmostEqual(pts[3, 0], 30)

    def test_obb_corners_stay_cyclic_at_45_degrees(self) -> None:
        """Same 45° case as score.order_corners: no collapsed/self-crossing quad."""
        from score import order_corners

        diamond = np.array([[100, 0], [200, 100], [100, 200], [0, 100]], float)
        for perm in ([0, 1, 2, 3], [2, 0, 3, 1], [3, 2, 1, 0]):
            q = order_corners(diamond[list(perm)])
            self.assertEqual(len({tuple(p) for p in q}), 4)
        pts = corners_from_xywhr(
            100, 100, math.sqrt(2) * 100, math.sqrt(2) * 100, math.radians(45)
        )
        self.assertEqual(len({tuple(np.round(p, 6)) for p in pts}), 4)

    def test_card_like_aspect(self) -> None:
        self.assertTrue(card_like(200, 280, 640, 480))
        self.assertFalse(card_like(400, 400, 640, 480))
        self.assertFalse(card_like(63, 88, 640, 480))

    def test_gate_requires_agpl_and_opt_in(self) -> None:
        self.assertFalse(pre_ship_allowed({}))
        self.assertFalse(pre_ship_allowed({"CARD_FLOW_YOLO26N_ONDEVICE": "true"}))
        self.assertTrue(
            pre_ship_allowed(
                {
                    "CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED": "true",
                    "CARD_FLOW_YOLO26N_ONDEVICE": "true",
                }
            )
        )
        self.assertFalse(
            pre_ship_allowed(
                {
                    "CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED": "true",
                    "CARD_FLOW_YOLO26N_ONDEVICE": "true",
                    "EAS_BUILD_PROFILE": "production",
                }
            )
        )
        with self.assertRaises(SystemExit) as raised:
            require_pre_ship({})
        self.assertEqual(raised.exception.code, 2)

    def test_eval_lists_yolo26n_detector(self) -> None:
        text = (HERE / "eval.py").read_text()
        self.assertIn('choices=["classical", "classical-legacy", "finder", "grader", "yolo26n"]', text)
        self.assertIn("run_yolo26n", text)


if __name__ == "__main__":
    unittest.main()
