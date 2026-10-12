import unittest

import numpy as np

from score import make_sample, polygon_iou, score_samples

GOLD = np.array([[0, 0], [630, 0], [630, 880], [0, 880]], float)


class ScoreTests(unittest.TestCase):
    def test_wrong_crop_accepted_is_counted(self) -> None:
        art = np.array([[40, 80], [590, 80], [590, 480], [40, 480]], float)
        good = make_sample("a", GOLD + 2, True, GOLD)
        wrong = make_sample("b", art, True, GOLD)
        retake = make_sample("c", GOLD, False, GOLD)
        card = score_samples([good, wrong, retake])
        self.assertTrue(wrong.wrong_accept)
        self.assertEqual(card.wrong_accept_count, 1)
        self.assertAlmostEqual(card.false_retake_rate, 0.5)
        self.assertFalse(card.passes)

    def test_perfect_set_passes(self) -> None:
        self.assertTrue(score_samples([make_sample(str(i), GOLD, True, GOLD) for i in range(50)]).passes)

    def test_order_corners_stays_cyclic_at_45_degrees(self) -> None:
        from score import order_corners

        diamond = np.array([[100, 0], [200, 100], [100, 200], [0, 100]], float)
        for perm in ([0, 1, 2, 3], [2, 0, 3, 1], [3, 2, 1, 0]):
            q = order_corners(diamond[perm])
            self.assertEqual(len({tuple(p) for p in q}), 4)
            self.assertAlmostEqual(polygon_iou(q, diamond), 1.0, places=6)


if __name__ == "__main__":
    unittest.main()
