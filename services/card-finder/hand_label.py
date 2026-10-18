"""Hand-label 4 virtual corners per photo by clicking (no snapping).

    python3 services/card-finder/hand_label.py rows.jsonl OUT_manifest.jsonl

rows.jsonl: manifest rows without corners (image, card, side, ...). A window shows
each photo; click the 4 virtual corners (where the straight edges would meet) in any
order. Each click opens a 4x zoom around it to place it to the pixel; click again in
the zoom to confirm. Keys: u = undo, s = skip, q = quit (progress is saved).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np

from score import order_corners

HERE = Path(__file__).resolve().parent
VIEW = 1100
ZOOM_R = 60


def zoom_pick(image: np.ndarray, x: float, y: float) -> tuple[float, float]:
    h, w = image.shape[:2]
    x0, y0 = int(max(0, x - ZOOM_R)), int(max(0, y - ZOOM_R))
    crop = image[y0:min(h, int(y + ZOOM_R)), x0:min(w, int(x + ZOOM_R))]
    big = cv2.resize(crop, None, fx=6, fy=6, interpolation=cv2.INTER_NEAREST)
    picked: list[tuple[float, float]] = []
    cv2.imshow("zoom", big)
    cv2.setMouseCallback("zoom", lambda e, u, v, *_: picked.append((x0 + u / 6, y0 + v / 6)) if e == cv2.EVENT_LBUTTONDOWN else None)
    while not picked:
        if cv2.waitKey(20) == 27:
            break
    cv2.destroyWindow("zoom")
    return picked[0] if picked else (x, y)


def main() -> None:
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    done = {json.loads(l)["image"] for l in out.read_text().splitlines()} if out.exists() else set()
    with out.open("a") as fh:
        for line in src.read_text().splitlines():
            row = json.loads(line)
            if row["image"] in done:
                continue
            image = cv2.imread(str(HERE / row["image"]))
            h, w = image.shape[:2]
            s = VIEW / max(h, w)
            clicks: list[tuple[float, float]] = []
            key = -1
            pending: list[tuple[float, float]] = []
            cv2.namedWindow("photo")
            cv2.setMouseCallback("photo", lambda e, u, v, *_: pending.append((u / s, v / s)) if e == cv2.EVENT_LBUTTONDOWN else None)
            while len(clicks) < 4:
                view = cv2.resize(image, (int(w * s), int(h * s)))
                for cx, cy in clicks:
                    cv2.drawMarker(view, (int(cx * s), int(cy * s)), (0, 255, 0), cv2.MARKER_CROSS, 24, 2)
                cv2.imshow("photo", view)
                key = cv2.waitKey(20)
                if pending:
                    clicks.append(zoom_pick(image, *pending.pop()))
                if key == ord("u") and clicks:
                    clicks.pop()
                if key in (ord("s"), ord("q")):
                    break
            if len(clicks) == 4:
                row["corners"] = [[round(x, 1), round(y, 1)] for x, y in order_corners(np.array(clicks))]
                row["label_method"] = "hand-clicked, no snapping"
                fh.write(json.dumps(row) + "\n")
                fh.flush()
            if key == ord("q"):
                break
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
