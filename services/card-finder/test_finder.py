"""The committed card-finder.onnx loads, matches its checksum, and finds a rendered card."""

import hashlib
import json
import unittest
from pathlib import Path

import cv2
import numpy as np

from finder import MODEL_PATH, THRESHOLD_PATH, CardFinder, upright_order
from score import polygon_iou

HERE = Path(__file__).resolve().parent


@unittest.skipUnless(MODEL_PATH.exists(), "card-finder.onnx not committed yet")
class FinderTests(unittest.TestCase):
    def test_model_checksum(self) -> None:
        expected = (HERE / "models" / "card-finder.onnx.sha256").read_text().split()[0]
        self.assertEqual(hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest(), expected)
        self.assertIn("accept_threshold", json.loads(THRESHOLD_PATH.read_text()))

    def test_finds_a_plain_card_on_a_dark_mat(self) -> None:
        rng = np.random.default_rng(0)
        image = (rng.normal(40, 6, (1600, 1200, 3))).clip(0, 255).astype(np.uint8)
        card = np.array([[330, 360], [870, 340], [890, 1090], [345, 1110]], np.float32)
        art = np.full((880, 630, 3), (60, 140, 230), np.uint8)
        cv2.rectangle(art, (40, 90), (590, 470), (200, 120, 40), -1)
        cv2.rectangle(art, (0, 0), (629, 879), (60, 200, 230), 26)
        hm = cv2.getPerspectiveTransform(np.float32([[0, 0], [630, 0], [630, 880], [0, 880]]), card)
        warped = cv2.warpPerspective(art, hm, (1200, 1600))
        alpha = cv2.warpPerspective(np.ones((880, 630), np.float32), hm, (1200, 1600))[..., None]
        image = (image * (1 - alpha) + warped * alpha).astype(np.uint8)
        found = CardFinder.load().find(image)
        self.assertIsNotNone(found)
        self.assertGreater(polygon_iou(found.corners, card), 0.9)

    def test_sideways_quad_is_put_upright(self) -> None:
        q = upright_order(np.array([[0, 0], [880, 0], [880, 630], [0, 630]], float))
        self.assertGreater(np.linalg.norm(q[3] - q[0]), np.linalg.norm(q[1] - q[0]))


if __name__ == "__main__":
    unittest.main()
