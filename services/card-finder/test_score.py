import unittest

import numpy as np

from score import make_sample, score_samples

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


if __name__ == "__main__":
    unittest.main()
