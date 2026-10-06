#!/usr/bin/env python3
"""Build a tiny OpenCLIP HNSW index for wiring smoke (no network)."""

from __future__ import annotations

import json
import struct
import zlib
from pathlib import Path

import hnswlib
import numpy as np
import open_clip
import torch
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "smoke-index"
EMBED_MODEL = "ViT-B-32"
EMBED_PRETRAINED = "openai"

# Deterministic solid-color cards — enough to exercise knn + API wiring.
SMOKE_CARDS = [
  ("base1-58", "Pikachu", (240, 200, 40)),
  ("base1-4", "Charizard", (220, 80, 40)),
  ("swsh3-136", "Crobat V", (80, 40, 140)),
]


def _device() -> torch.device:
  if torch.cuda.is_available():
    return torch.device("cuda")
  if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
    return torch.device("mps")
  return torch.device("cpu")


def card_image(rgb: tuple[int, int, int], label: str) -> Image.Image:
  img = Image.new("RGB", (224, 312), rgb)
  draw = ImageDraw.Draw(img)
  draw.rectangle((12, 12, 212, 300), outline=(20, 20, 20), width=3)
  draw.text((24, 140), label[:12], fill=(10, 10, 10))
  return img


def main() -> None:
  OUT.mkdir(parents=True, exist_ok=True)
  device = _device()
  model, _, preprocess = open_clip.create_model_and_transforms(
    EMBED_MODEL, pretrained=EMBED_PRETRAINED, device=device
  )
  model.eval()

  vectors: list[np.ndarray] = []
  rows: list[dict[str, str]] = []
  with torch.no_grad():
    for tcgdex_id, name, color in SMOKE_CARDS:
      pil = card_image(color, name)
      pil.save(OUT / f"{tcgdex_id}.jpg", quality=90)
      tensor = preprocess(pil).unsqueeze(0).to(device)
      feats = model.encode_image(tensor)
      feats = feats / feats.norm(dim=-1, keepdim=True)
      vectors.append(feats.cpu().numpy().astype("float32")[0])
      rows.append({"tcgdexId": tcgdex_id, "name": name})

  data = np.vstack(vectors)
  dim = int(data.shape[1])
  index = hnswlib.Index(space="cosine", dim=dim)
  index.init_index(max_elements=len(rows), ef_construction=100, M=16)
  index.add_items(data, np.arange(len(rows)))
  index.set_ef(50)
  index.save_index(str(OUT / "hnsw.bin"))
  (OUT / "meta.json").write_text(
    json.dumps({"dim": dim, "model": EMBED_MODEL, "rows": rows}, indent=2) + "\n"
  )
  # Touch a tiny marker so gitignore can keep data/ but docs know smoke exists.
  print(f"wrote {OUT} ({len(rows)} cards, dim={dim})")
  print("LIVE_IDENTITY_INDEX=" + str(OUT))


if __name__ == "__main__":
  main()
