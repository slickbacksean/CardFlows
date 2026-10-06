#!/usr/bin/env python3
"""
Tune the sidecar accept gate (LIVE_IDENTITY_ACCEPT + LIVE_IDENTITY_MARGIN) on the built index.

Samples indexed cards, downloads their high.jpg (a different render than the indexed
low.jpg), degrades each into livestream-like crops, and scores every query two ways:

  indexed   — the true card is in the index: correct accept / wrong accept / reject
  unindexed — every card from the query's set is hidden (a set not indexed yet):
              any accept is a false accept

  python scripts/eval_accept.py [--index data/index] [--sample 800] [--seed 7]

Downloads cache under data/eval/ (gitignored). Needs no running sidecar.
"""

from __future__ import annotations

import argparse
import io
import json
import random
import time
from collections import Counter
from pathlib import Path
from typing import Any

import hnswlib
import httpx
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

from build_tcgdex_index import load_model

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PLAN = DATA / "batches" / "plan.json"
HIGH = DATA / "eval" / "high"
ACCEPTS = [round(0.80 + 0.01 * i, 2) for i in range(16)]
MARGINS = [0.0, 0.005, 0.01, 0.015, 0.02, 0.03, 0.04, 0.05]
LEVELS = ("mild", "live")
SEARCH_K = 300


def fetch_high(client: httpx.Client, cards: list[dict[str, str]]) -> list[dict[str, str]]:
  """Cache high.jpg for each card; retry misses in slower passes. Returns cards with art."""
  HIGH.mkdir(parents=True, exist_ok=True)
  pending = [c for c in cards if not (HIGH / f"{c['tcgdexId']}.jpg").is_file()]
  for pause in (0.05, 0.5, 1.0):
    missed = []
    for card in pending:
      try:
        resp = client.get(f"{card['image']}/high.jpg")
      except httpx.HTTPError:
        missed.append(card)
        continue
      finally:
        time.sleep(pause)
      if resp.status_code == 200:
        (HIGH / f"{card['tcgdexId']}.jpg").write_bytes(resp.content)
      else:
        missed.append(card)
    pending = missed
    if not pending:
      break
  missing = {c["tcgdexId"] for c in pending}
  if missing:
    print(f"no high.jpg for {len(missing)} sampled cards; dropped")
  return [c for c in cards if c["tcgdexId"] not in missing]


def degrade(image: Image.Image, level: str, rng: random.Random) -> Image.Image:
  """Approximate a detector crop of a sleeved card from compressed live video."""
  live = level == "live"
  img = image.convert("RGB").resize((300, 418))

  pad = int(img.width * rng.uniform(0.0, 0.08 if live else 0.02))
  if pad:
    bg = tuple(rng.randint(10, 90) for _ in range(3))
    framed = Image.new("RGB", (img.width + 2 * pad, img.height + 2 * pad), bg)
    framed.paste(img, (pad, pad))
    img = framed
  angle = rng.uniform(-6, 6) if live else rng.uniform(-2, 2)
  img = img.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=(40, 40, 40))
  cut = rng.uniform(0.0, 0.05 if live else 0.02)
  w, h = img.size
  img = img.crop((int(w * cut), int(h * cut), int(w * (1 - cut)), int(h * (1 - cut))))

  if live and rng.random() < 0.5:
    glare = Image.new("L", img.size, 0)
    gx, gy = rng.uniform(0.1, 0.9) * img.width, rng.uniform(0.1, 0.9) * img.height
    rx, ry = img.width * rng.uniform(0.1, 0.3), img.height * rng.uniform(0.05, 0.15)
    ImageDraw.Draw(glare).ellipse((gx - rx, gy - ry, gx + rx, gy + ry), fill=rng.randint(60, 140))
    glare = glare.filter(ImageFilter.GaussianBlur(20))
    img = Image.composite(Image.new("RGB", img.size, (255, 255, 255)), img, glare)

  spread = 0.25 if live else 0.1
  for enhance in (ImageEnhance.Brightness, ImageEnhance.Contrast, ImageEnhance.Color):
    img = enhance(img).enhance(rng.uniform(1 - spread, 1 + spread))
  cast = np.array([rng.uniform(1 - spread / 3, 1 + spread / 3) for _ in range(3)])
  img = Image.fromarray(np.clip(np.asarray(img, dtype=np.float32) * cast, 0, 255).astype("uint8"))

  width = rng.randint(120, 200) if live else rng.randint(220, 300)
  img = img.resize((width, int(width * img.height / img.width)), Image.BILINEAR)
  img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.5, 1.5) if live else rng.uniform(0, 0.6)))
  buf = io.BytesIO()
  img.save(buf, "JPEG", quality=rng.randint(25, 50) if live else rng.randint(60, 80))
  return Image.open(io.BytesIO(buf.getvalue())).convert("RGB")


def embed(images: list[Image.Image], model: Any, preprocess: Any, device: torch.device) -> np.ndarray:
  out = []
  for start in range(0, len(images), 64):
    batch = torch.stack([preprocess(im) for im in images[start : start + 64]]).to(device)
    with torch.no_grad():
      feats = model.encode_image(batch)
      feats = feats / feats.norm(dim=-1, keepdim=True)
    out.append(feats.cpu().numpy().astype("float32"))
  return np.vstack(out)


def top2(
  labels: np.ndarray, sims: np.ndarray, rows: list[dict[str, Any]], hidden_set: str | None
) -> tuple[str, float, float]:
  kept = [
    (rows[l]["tcgdexId"], float(s))
    for l, s in zip(labels, sims)
    if hidden_set is None or rows[l]["setId"] != hidden_set
  ]
  if not kept:
    return "", 0.0, 0.0
  return kept[0][0], kept[0][1], kept[1][1] if len(kept) > 1 else 0.0


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--index", type=Path, default=DATA / "index")
  parser.add_argument("--sample", type=int, default=800)
  parser.add_argument("--seed", type=int, default=7)
  args = parser.parse_args()

  meta = json.loads((args.index / "meta.json").read_text())
  plan_cards = {c["tcgdexId"]: c for g in json.loads(PLAN.read_text())["groups"] for c in g["cards"]}
  rows = [dict(r, setId=plan_cards[r["tcgdexId"]]["setId"]) for r in meta["rows"]]
  index = hnswlib.Index(space="cosine", dim=int(meta["dim"]))
  index.load_index(str(args.index / "hnsw.bin"))
  index.set_ef(SEARCH_K)

  rng = random.Random(args.seed)
  sample = [plan_cards[r["tcgdexId"]] for r in rng.sample(rows, min(args.sample, len(rows)))]
  with httpx.Client(timeout=60.0, follow_redirects=True) as client:
    sample = fetch_high(client, sample)
  names = {r["tcgdexId"]: r["name"] for r in rows}
  print(f"{len(sample)} sampled cards; {len(rows)} indexed")

  model, preprocess, device = load_model()
  for level in LEVELS:
    level_rng = random.Random(f"{args.seed}-{level}")
    queries = [degrade(Image.open(HIGH / f"{c['tcgdexId']}.jpg"), level, level_rng) for c in sample]
    labels, dists = index.knn_query(embed(queries, model, preprocess, device), k=SEARCH_K)
    sims = 1.0 - dists
    indexed = [top2(labels[i], sims[i], rows, None) for i in range(len(sample))]
    unindexed = [top2(labels[i], sims[i], rows, c["setId"]) for i, c in enumerate(sample)]
    truth = [c["tcgdexId"] for c in sample]

    top1_right = sum(t[0] == truth[i] for i, t in enumerate(indexed))
    wrong_same_name = Counter(
      "same name" if names.get(t[0]) == names[truth[i]] else "other"
      for i, t in enumerate(indexed)
      if t[0] != truth[i]
    )
    print(f"\n== {level}: top-1 correct {top1_right}/{len(sample)}; top-1 misses {dict(wrong_same_name)}")
    print(" accept margin  correct  wrong  false(unindexed)")
    results = []
    for accept in ACCEPTS:
      for margin in MARGINS:
        def ok(t: tuple[str, float, float]) -> bool:
          return bool(t[0]) and t[1] >= accept and t[1] - t[2] >= margin

        correct = sum(ok(t) and t[0] == truth[i] for i, t in enumerate(indexed))
        wrong = sum(ok(t) and t[0] != truth[i] for i, t in enumerate(indexed))
        false = sum(ok(t) for t in unindexed)
        results.append((accept, margin, correct, wrong, false))
    n = len(sample)
    for accept, margin, correct, wrong, false in results:
      if margin in (0.0, 0.01, 0.02, 0.03) or (wrong + false) / (2 * n) <= 0.01:
        print(
          f"  {accept:.2f}  {margin:.3f}   {100 * correct / n:5.1f}%  {100 * wrong / n:4.1f}%"
          f"  {100 * false / n:5.1f}%"
        )
    best = [
      r for r in results if r[3] / n <= 0.01 and r[4] / n <= 0.02
    ]
    if best:
      b = max(best, key=lambda r: (r[2], -r[4], -r[0]))
      print(
        f"  best with wrong<=1% and false<=2%: accept {b[0]:.2f} margin {b[1]:.3f} "
        f"-> correct {100 * b[2] / n:.1f}%, wrong {100 * b[3] / n:.1f}%, false {100 * b[4] / n:.1f}%"
      )


if __name__ == "__main__":
  main()
