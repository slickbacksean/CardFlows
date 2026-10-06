"""Generate a synthetic front/back card photo pair for the grader e2e test.

Usage: python make-grade-fixture.py FRONT.jpg BACK.jpg
A 3024x4032 photo of a 63:88 card on a dark background, slightly off-centre.
Deterministic (fixed seeds), so CI grades the same pixels every run.
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

def card(path, face, W=3024, H=4032, cw=1800, seed=1):
    rng = np.random.default_rng(seed)
    ch = round(cw * 88 / 63)
    bg = (rng.normal(40, 4, (H, W, 3))).clip(0, 255).astype(np.uint8)
    img = Image.fromarray(bg, "RGB")
    x0 = (W - cw) // 2 + 20
    y0 = (H - ch) // 2 - 10
    d = ImageDraw.Draw(img)
    if face == "front":
        d.rounded_rectangle([x0, y0, x0 + cw, y0 + ch], radius=60, fill=(236, 200, 40))
        b = int(cw * 0.055)
        bl, br, bt, bb = b + 8, b - 8, b + 6, b - 6   # slightly off-center
        ix0, iy0, ix1, iy1 = x0 + bl, y0 + bt, x0 + cw - br, y0 + ch - bb
        d.rectangle([ix0, iy0, ix1, iy1], fill=(214, 220, 228))
        art = (rng.normal(120, 30, (int((iy1 - iy0) * 0.42), ix1 - ix0 - 80, 3))).clip(0, 255).astype(np.uint8)
        img.paste(Image.fromarray(art, "RGB").filter(ImageFilter.GaussianBlur(6)), (ix0 + 40, iy0 + 140))
        d.rectangle([ix0 + 40, iy0 + 30, ix1 - 40, iy0 + 110], fill=(250, 250, 250))
        for k in range(6):
            yy = iy0 + int((iy1 - iy0) * 0.55) + k * 120
            d.rectangle([ix0 + 60, yy, ix1 - 60, yy + 50], fill=(190, 196, 204))
    else:
        d.rounded_rectangle([x0, y0, x0 + cw, y0 + ch], radius=60, fill=(30, 70, 170))
        b = int(cw * 0.06)
        d.rounded_rectangle([x0 + b + 5, y0 + b, x0 + cw - b + 5, y0 + ch - b], radius=30, fill=(40, 100, 210))
        d.ellipse([x0 + cw * 0.25, y0 + ch * 0.3, x0 + cw * 0.75, y0 + ch * 0.66], fill=(230, 60, 50))
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    img.save(path, "JPEG", quality=88)

card(sys.argv[1], "front")
card(sys.argv[2], "back", seed=2)
