"""Real-photo samples for fine-tuning: (letterboxed image, card mask) from manifests.

Each manifest row has an image path and 4 corners at full resolution (see real_data.py).
Images are cached at long side 1024 px. Augmentation: rotation/scale/shift, colour,
blur, JPEG; the card mask is the quad warped the same way.
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path

import cv2
import numpy as np

CACHE_LONG = 1024


class RealSampler:
    def __init__(self, manifests: list[Path], split: str, size: int = 256, seed: int = 0):
        self.size = size
        self.rng = random.Random(seed)
        self.rows = []
        for m in manifests:
            for line in Path(m).read_text().splitlines():
                r = json.loads(line)
                if r["split"] == split and r.get("corners"):
                    self.rows.append(r)
        self._cache: dict[str, tuple[np.ndarray, np.ndarray]] = {}

    def __len__(self) -> int:
        return len(self.rows)

    def load(self, r: dict) -> tuple[np.ndarray, np.ndarray]:
        key = r["image"]
        if key not in self._cache:
            img = cv2.imread(key)
            s = CACHE_LONG / max(img.shape[:2])
            img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
            self._cache[key] = (img, np.array(r["corners"], np.float32) * s)
        return self._cache[key]

    def sample(self, augment: bool = True) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        rng = self.rng
        img, quad = self.load(rng.choice(self.rows))
        h, w = img.shape[:2]
        if augment:
            ang = rng.uniform(-180, 180) if rng.random() < 0.3 else rng.gauss(0, 8)
            sc = rng.uniform(0.75, 1.25)
            c = quad.mean(0)
            m = cv2.getRotationMatrix2D((float(c[0]), float(c[1])), ang, sc)
            m[:, 2] += [rng.uniform(-0.12, 0.12) * w, rng.uniform(-0.12, 0.12) * h]
            img = cv2.warpAffine(img, m, (w, h), borderMode=cv2.BORDER_REFLECT101)
            quad = cv2.transform(quad[None], m)[0]
            out = img.astype(np.float32) * rng.uniform(0.6, 1.3) * np.array([rng.uniform(0.85, 1.15) for _ in range(3)])
            if rng.random() < 0.4:
                out = cv2.GaussianBlur(out, (0, 0), rng.uniform(0.5, 2.5))
            out = np.clip(out + np.random.default_rng(rng.randrange(1 << 30)).normal(0, rng.uniform(1, 6), out.shape), 0, 255).astype(np.uint8)
            img = cv2.imdecode(cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, rng.randint(40, 95)])[1], cv2.IMREAD_COLOR)
        s = self.size / max(h, w)
        nh, nw = int(round(h * s)), int(round(w * s))
        y0, x0 = (self.size - nh) // 2, (self.size - nw) // 2
        canvas = np.zeros((self.size, self.size, 3), np.uint8)
        canvas[y0:y0 + nh, x0:x0 + nw] = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)
        mask = np.zeros((self.size, self.size), np.uint8)
        q = quad * s + [x0, y0]
        cv2.fillPoly(mask, [np.round(q).astype(np.int32)], 1)
        mask[:y0], mask[y0 + nh:], mask[:, :x0], mask[:, x0 + nw:] = 0, 0, 0, 0
        return canvas, mask, q
