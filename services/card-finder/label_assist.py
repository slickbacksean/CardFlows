"""Label helper: snap rough corners to the card's real edges, then check by eye.

    python3 services/card-finder/label_assist.py rough.jsonl OUT_manifest.jsonl --sheets OUT_DIR

rough.jsonl rows are manifest rows (see TESTSET.md) whose "corners" are rough
clicks (any order, within ~2% of the card edge). Each edge is re-fit from image
gradients (RANSAC + Huber line fit) and corners become the edge-line
intersections ("virtual corners", the convention for every label and every
detector output). A review sheet per photo shows 4 zoomed corners with a cross;
reject and re-click any whose cross is not on the corner.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from score import order_corners

HERE = Path(__file__).resolve().parent


def refine(image: np.ndarray, quad: np.ndarray, band: float = 0.025, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    h, w = image.shape[:2]
    sc = 1200 / max(h, w)
    small = cv2.resize(image, (int(w * sc), int(h * sc)))
    gray = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1)
    q = order_corners(quad) * sc
    diag = float(np.linalg.norm(q[2] - q[0]))
    lines = []
    for i in range(4):
        a, b = q[i], q[(i + 1) % 4]
        d = (b - a) / np.linalg.norm(b - a)
        n = np.array([-d[1], d[0]])
        pts = []
        offs = np.arange(-band * diag, band * diag, 0.5)
        for t in np.linspace(0.08, 0.92, 60):
            p = (a + (b - a) * t)[None] + offs[:, None] * n[None]
            xi = np.clip(p[:, 0].astype(int), 0, small.shape[1] - 1)
            yi = np.clip(p[:, 1].astype(int), 0, small.shape[0] - 1)
            m = np.abs(gx[yi, xi] * n[0] + gy[yi, xi] * n[1])
            k = int(m.argmax())
            if m[k] > 20:
                pts.append(p[k])
        pts = np.array(pts, np.float32)
        if len(pts) < 6:
            lines.append((a, d))
            continue
        best = None
        for _ in range(200):
            i1, i2 = rng.choice(len(pts), 2, replace=False)
            dd = pts[i2] - pts[i1]
            if np.linalg.norm(dd) < 1:
                continue
            nn = np.array([-dd[1], dd[0]]) / np.linalg.norm(dd)
            inl = np.abs((pts - pts[i1]) @ nn) < 1.5
            if best is None or inl.sum() > best.sum():
                best = inl
        vx, vy, x0, y0 = cv2.fitLine(pts[best], cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        lines.append((np.array([x0, y0]), np.array([vx, vy])))
    out = []
    for i in range(4):
        (p1, d1), (p2, d2) = lines[i - 1], lines[i]
        t = np.linalg.solve(np.array([d1, -d2]).T, p2 - p1)
        out.append(p1 + d1 * t[0])
    return np.array(out) / sc


def review_sheet(image: np.ndarray, corners: np.ndarray) -> np.ndarray:
    h, w = image.shape[:2]
    r = int(0.04 * max(h, w))
    pad = cv2.copyMakeBorder(image, r, r, r, r, cv2.BORDER_CONSTANT)
    crops = []
    for x, y in corners.astype(int):
        c = cv2.resize(pad[y:y + 2 * r, x:x + 2 * r], (240, 240))
        cv2.drawMarker(c, (120, 120), (0, 255, 0), cv2.MARKER_CROSS, 36, 1)
        crops.append(c)
    return np.vstack([np.hstack(crops[:2]), np.hstack([crops[3], crops[2]])])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("rough", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--sheets", type=Path)
    args = ap.parse_args()
    rows = []
    for line in args.rough.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        image = cv2.imread(str(HERE / row["image"]))
        quad = refine(image, np.asarray(row["corners"], float))
        quad = refine(image, quad, band=0.008)
        row["corners"] = [[round(float(x), 1), round(float(y), 1)] for x, y in quad]
        row.setdefault("label_method", "label_assist edge snap, corners checked by eye")
        rows.append(row)
        if args.sheets:
            args.sheets.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(args.sheets / (Path(row["image"]).stem + ".jpg")), review_sheet(image, quad))
    args.out.write_text("".join(json.dumps(r) + "\n" for r in rows))


if __name__ == "__main__":
    main()
