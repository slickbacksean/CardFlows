"""Synthetic training composites for the card-finder mask model.

Card art: TCGdex card images (approved by Sean for training, 2026-10-11).
Backgrounds: Poly Haven textures (CC0) plus procedural desks/mats/laptops.
Each sample is a phone-like photo of one card (or none) with a binary card mask.

Card backs are a generic swirl pattern (no text or logos).
Art is filtered by train/art-list.tsv (denylisted baseline/test-set cards removed, train/val split by id).

Hard negatives (masked as background): a lone art-window crop, a text panel,
a sheet of paper, a phone or laptop rectangle, a second card cut by the frame edge
is labeled card only where visible.
"""

from __future__ import annotations

import glob
import math
import random

import cv2
import numpy as np

CARD_W, CARD_H = 63.0, 88.0


def rounded_mask(w: int, h: int, r: int) -> np.ndarray:
    m = np.zeros((h, w), np.uint8)
    cv2.rectangle(m, (r, 0), (w - r - 1, h - 1), 255, -1)
    cv2.rectangle(m, (0, r), (w - 1, h - r - 1), 255, -1)
    for cx, cy in ((r, r), (w - r - 1, r), (r, h - r - 1), (w - r - 1, h - r - 1)):
        cv2.circle(m, (cx, cy), r, 255, -1)
    return m


def card_back(w: int, h: int, rng: random.Random) -> np.ndarray:
    """Generic card-back look-alike: dark border, two-tone swirl, plain disc. No text or logos."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    ang = np.arctan2(y - h / 2, x - w / 2) + np.hypot(x - w / 2, y - h / 2) / (w * rng.uniform(0.25, 0.5))
    swirl = (0.5 + 0.5 * np.sin(ang * rng.randint(2, 5))).astype(np.float32)
    base = np.array([rng.uniform(80, 200), rng.uniform(40, 140), rng.uniform(20, 90)], np.float32)
    img = base[None, None, :] * (0.6 + 0.6 * swirl[..., None])
    b = int(w * rng.uniform(0.04, 0.07))
    border = tuple(float(v) for v in base * 0.55)
    img[:b], img[-b:], img[:, :b], img[:, -b:] = border, border, border, border
    img = np.clip(img, 0, 255).astype(np.uint8)
    cv2.circle(img, (w // 2, h // 2), int(w * rng.uniform(0.12, 0.25)), tuple(int(rng.uniform(150, 240)) for _ in range(3)), -1)
    return img


class Synth:
    def __init__(self, art_glob: str, tex_glob: str, size: int = 256, seed: int = 0, art_ids: set[str] | None = None):
        import os

        self.art = sorted(p for p in glob.glob(art_glob) if art_ids is None or os.path.splitext(os.path.basename(p))[0] in art_ids)
        self.tex = sorted(glob.glob(tex_glob))
        self.size = size
        self.rng = random.Random(seed)
        self._tex_cache: dict[str, np.ndarray] = {}

    # ---------- backgrounds
    def texture(self, h: int, w: int) -> np.ndarray:
        rng = self.rng
        kind = rng.random()
        if kind < 0.55 and self.tex:
            path = rng.choice(self.tex)
            t = self._tex_cache.get(path)
            if t is None:
                t = cv2.imread(path)
                self._tex_cache[path] = t
            s = rng.uniform(0.5, 2.0)
            t2 = cv2.resize(t, None, fx=s, fy=s)
            reps = (math.ceil(h / t2.shape[0]) + 1, math.ceil(w / t2.shape[1]) + 1, 1)
            t2 = np.tile(t2, reps)
            y0, x0 = rng.randrange(t2.shape[0] - h + 1), rng.randrange(t2.shape[1] - w + 1)
            bg = t2[y0:y0 + h, x0:x0 + w].astype(np.float32)
            bg = bg * rng.uniform(0.25, 1.2) + rng.uniform(-30, 30)
            if rng.random() < 0.5:  # desaturate toward dark mats / grey desks
                g = bg.mean(axis=2, keepdims=True)
                a = rng.uniform(0.3, 1)
                bg = bg * (1 - a) + g * a
        else:
            col = np.array([rng.uniform(10, 230) for _ in range(3)], np.float32)
            if rng.random() < 0.5:
                col[:] = rng.uniform(15, 200)
            bg = np.ones((h, w, 3), np.float32) * col
            noise = cv2.GaussianBlur(np.random.default_rng(rng.randrange(1 << 30)).normal(0, rng.uniform(2, 18), (h, w, 1)).astype(np.float32), (0, 0), rng.uniform(0.5, 3))
            bg += noise.reshape(h, w, 1)
        if rng.random() < 0.3:  # laptop / desk edge
            x = rng.randrange(w)
            c = rng.uniform(90, 200)
            pts = np.array([[x, 0], [w, 0], [w, h], [x + rng.randint(-w // 4, w // 4), h]], np.int32)
            cv2.fillPoly(bg, [pts], (c, c, c * rng.uniform(0.95, 1.05)))
            if rng.random() < 0.5:
                for _ in range(rng.randint(3, 12)):
                    kx, ky = rng.randrange(w), rng.randrange(h // 3)
                    cv2.rectangle(bg, (kx, ky), (kx + w // 14, ky + h // 22), (c * 0.25,) * 3, -1)
        return np.clip(bg, 0, 255)

    # ---------- card geometry
    def homography_quad(self, h: int, w: int, card_px_w: float) -> np.ndarray:
        rng = self.rng
        f = 0.75 * max(h, w)
        pitch, yaw = math.radians(rng.gauss(0, 10)), math.radians(rng.gauss(0, 10))
        if rng.random() < 0.15:
            pitch = math.radians(rng.uniform(-30, 30))
        roll = rng.uniform(-math.pi, math.pi) if rng.random() < 0.25 else math.radians(rng.gauss(0, 8))
        rx = np.array([[1, 0, 0], [0, math.cos(pitch), -math.sin(pitch)], [0, math.sin(pitch), math.cos(pitch)]])
        ry = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])
        rz = np.array([[math.cos(roll), -math.sin(roll), 0], [math.sin(roll), math.cos(roll), 0], [0, 0, 1]])
        z = f * CARD_W / card_px_w
        pts = np.array([[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]], float) * [CARD_W / 2, CARD_H / 2, 0]
        cam = (ry @ rx @ rz @ pts.T).T
        cx = rng.uniform(-0.17, 0.17) * w * z / f
        cy = rng.uniform(-0.17, 0.17) * h * z / f
        cam = cam + [cx, cy, z]
        uv = cam[:, :2] / cam[:, 2:] * f + [w / 2, h / 2]
        return uv.astype(np.float32)

    def card_image(self) -> np.ndarray:
        rng = self.rng
        if rng.random() < 0.2:
            return card_back(245 * 2, 342 * 2, rng)
        img = cv2.imread(rng.choice(self.art))
        return cv2.resize(img, (490, 684))

    def paste(self, bg, card_img, quad, mask, *, holder: str):
        rng = self.rng
        h, w = bg.shape[:2]
        ch, cw = card_img.shape[:2]
        src = np.float32([[0, 0], [cw, 0], [cw, ch], [0, ch]])
        hm = cv2.getPerspectiveTransform(src, quad)
        alpha_src = rounded_mask(cw, ch, int(cw * 0.045)).astype(np.float32) / 255
        if holder != "raw":  # sleeve / toploader: a clear, slightly larger rectangle with highlights
            pad = 0.04 if holder == "sleeve" else 0.10
            big = np.float32([[-pad * cw, -pad * ch], [(1 + pad) * cw, -pad * ch], [(1 + pad) * cw, (1 + pad * 0.6) * ch], [-pad * cw, (1 + pad * 0.6) * ch]])
            hq = cv2.perspectiveTransform(big[None], hm)[0]
            over = bg.copy()
            cv2.fillPoly(over, [hq.astype(np.int32)], (235, 235, 240))
            a = rng.uniform(0.05, 0.25)
            bg[:] = bg * (1 - a) + over * a
            cv2.polylines(bg, [hq.astype(np.int32)], True, (220, 220, 225), max(1, w // 300))
        warped = cv2.warpPerspective(card_img.astype(np.float32), hm, (w, h))
        alpha = cv2.warpPerspective(alpha_src, hm, (w, h))[..., None]
        bg[:] = bg * (1 - alpha) + warped * alpha
        mask[:] = np.maximum(mask, (alpha[..., 0] > 0.5).astype(np.uint8))

    def distractor(self, bg, mask):
        rng = self.rng
        h, w = bg.shape[:2]
        kind = rng.choice(["art", "paper", "panel", "phone"])
        cx, cy = rng.uniform(0.1, 0.9) * w, rng.uniform(0.1, 0.9) * h
        s = rng.uniform(0.1, 0.35) * w
        if kind == "art":
            img = cv2.imread(rng.choice(self.art))
            img = img[int(img.shape[0] * 0.11):int(img.shape[0] * 0.5), int(img.shape[1] * 0.08):int(img.shape[1] * 0.92)]
            ar = img.shape[0] / img.shape[1]
        elif kind == "panel":
            img = cv2.imread(rng.choice(self.art))
            img = img[int(img.shape[0] * 0.55):int(img.shape[0] * 0.93), int(img.shape[1] * 0.06):int(img.shape[1] * 0.94)]
            ar = img.shape[0] / img.shape[1]
        elif kind == "paper":
            img = np.full((300, 230, 3), rng.uniform(200, 250), np.uint8)
            ar = 297 / 210 if rng.random() < 0.5 else 0.7
            s *= 1.8
        else:
            img = np.full((300, 150, 3), rng.uniform(5, 40), np.uint8)
            ar = 2.1
        ang = rng.uniform(0, 2 * math.pi)
        dx, dy = s / 2, s * ar / 2
        pts = np.array([[-dx, -dy], [dx, -dy], [dx, dy], [-dx, dy]])
        rot = np.array([[math.cos(ang), -math.sin(ang)], [math.sin(ang), math.cos(ang)]])
        quad = (pts @ rot.T + [cx, cy]).astype(np.float32)
        src = np.float32([[0, 0], [img.shape[1], 0], [img.shape[1], img.shape[0]], [0, img.shape[0]]])
        hm = cv2.getPerspectiveTransform(src, quad)
        warped = cv2.warpPerspective(img.astype(np.float32), hm, (w, h))
        a = cv2.warpPerspective(np.ones(img.shape[:2], np.float32), hm, (w, h))[..., None]
        bg[:] = bg * (1 - a) + warped * a
        mask[a[..., 0] > 0.5] = 0  # whatever covers a card is not card

    def photo_effects(self, img: np.ndarray) -> np.ndarray:
        rng = self.rng
        h, w = img.shape[:2]
        y, x = np.mgrid[0:h, 0:w].astype(np.float32)
        gx, gy = rng.uniform(-1, 1), rng.uniform(-1, 1)
        grad = 1 + rng.uniform(0, 0.5) * ((x / w - 0.5) * gx + (y / h - 0.5) * gy)
        img = img * grad[..., None]
        if rng.random() < 0.5:  # shadow blob
            sh = np.zeros((h, w), np.float32)
            cv2.ellipse(sh, (rng.randrange(w), rng.randrange(h)), (rng.randrange(w // 4, w), rng.randrange(h // 4, h)), rng.uniform(0, 180), 0, 360, 1, -1)
            sh = cv2.GaussianBlur(sh, (0, 0), w / 15)
            img = img * (1 - rng.uniform(0.2, 0.6) * sh[..., None])
        if rng.random() < 0.5:  # glare
            gl = np.zeros((h, w), np.float32)
            cv2.ellipse(gl, (rng.randrange(w), rng.randrange(h)), (rng.randrange(5, w // 5), rng.randrange(5, h // 8)), rng.uniform(0, 180), 0, 360, 1, -1)
            gl = cv2.GaussianBlur(gl, (0, 0), rng.uniform(2, 12))
            img = img + 255 * rng.uniform(0.4, 1.0) * gl[..., None]
        if rng.random() < 0.25:  # hand / finger
            col = np.array([rng.uniform(60, 140), rng.uniform(90, 170), rng.uniform(140, 230)])
            ex, ey = rng.randrange(w), rng.choice([0, h])
            cv2.ellipse(img, (ex, ey), (rng.randrange(w // 12, w // 4), rng.randrange(h // 8, h // 3)), rng.uniform(0, 180), 0, 360, col.tolist(), -1)
        if rng.random() < 0.2:  # hand-shake motion blur
            n = rng.randint(3, 9)
            kern = np.zeros((n, n), np.float32)
            kern[n // 2] = 1 / n
            rot = cv2.getRotationMatrix2D((n / 2 - 0.5, n / 2 - 0.5), rng.uniform(0, 180), 1)
            kern = cv2.warpAffine(kern, rot, (n, n))
            img = cv2.filter2D(img, -1, kern / max(kern.sum(), 1e-6))
        if rng.random() < 0.3:  # white balance / exposure
            img = img * np.array([rng.uniform(0.8, 1.2), rng.uniform(0.9, 1.1), rng.uniform(0.8, 1.2)]) * rng.uniform(0.6, 1.3)
        k = rng.choice([0, 0, 1, 2, 3])
        if k:
            img = cv2.GaussianBlur(img, (0, 0), k * rng.uniform(0.4, 1.0))
        img = img + np.random.default_rng(rng.randrange(1 << 30)).normal(0, rng.uniform(1, 8), img.shape)
        img = np.clip(img, 0, 255).astype(np.uint8)
        q = rng.randint(40, 95)
        img = cv2.imdecode(cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])[1], cv2.IMREAD_COLOR)
        return img

    def sample(self) -> tuple[np.ndarray, np.ndarray]:
        rng = self.rng
        s = self.size
        portrait = rng.random() < 0.7
        h, w = (s, int(s * 0.75)) if portrait else (int(s * 0.75), s)
        work = 2
        H, W = h * work, w * work
        bg = self.texture(H, W)
        mask = np.zeros((H, W), np.uint8)
        self.last_quad, self.last_findable, quad_full = None, False, None
        if rng.random() < 0.08:  # empty frame (only distractors)
            for _ in range(rng.randint(1, 2)):
                self.distractor(bg, mask)
        else:
            card_px = rng.uniform(0.22, 0.75) * min(H, W)
            quad = self.homography_quad(H, W, card_px)
            holder = rng.choices(["raw", "sleeve", "toploader"], [0.6, 0.25, 0.15])[0]
            if rng.random() < 0.35:
                self.distractor(bg, mask)
            self.paste(bg, self.card_image(), quad, mask, holder=holder)
            covered = rng.random() < 0.2
            if covered:
                self.distractor(bg, mask)
            inside = bool(((quad >= 0) & (quad <= [W - 1, H - 1])).all())
            self.last_findable = inside and not covered
            quad_full = quad
        img = self.photo_effects(bg)
        img = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
        mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)
        # letterbox to s x s
        out = np.zeros((s, s, 3), np.uint8)
        om = np.zeros((s, s), np.uint8)
        y0, x0 = (s - h) // 2, (s - w) // 2
        out[y0:y0 + h, x0:x0 + w] = img
        om[y0:y0 + h, x0:x0 + w] = mask
        self.last_box = (x0, y0, w, h)  # content area inside the letterbox
        if quad_full is not None:
            self.last_quad = quad_full / work + [x0, y0]
        return out, om
