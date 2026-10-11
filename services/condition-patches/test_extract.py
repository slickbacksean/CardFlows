import unittest

import numpy as np

from extract import CORNER, EDGE_LONG, EDGE_SHORT, patches


class PatchTests(unittest.TestCase):
    def test_twelve_patches_with_fixed_shapes(self) -> None:
        out = patches(np.zeros((2100, 1500, 3), np.uint8))
        self.assertEqual(len(out), 12)
        self.assertEqual(out["corner_br"].shape[:2], (CORNER, CORNER))
        for name, patch in out.items():
            if name.startswith("edge"):
                self.assertEqual(patch.shape[:2], (EDGE_SHORT, EDGE_LONG), name)


if __name__ == "__main__":
    unittest.main()
