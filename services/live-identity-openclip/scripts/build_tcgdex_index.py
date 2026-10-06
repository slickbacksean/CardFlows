#!/usr/bin/env python3
"""
Build a full English OpenCLIP HNSW index from TCGdex art (tcgdex_id keys).

Downloads low.jpg (low.png if missing) from assets.tcgdex.net — never Pocket art, never WebP.
Output is gitignored. Slow; run once locally. For the full catalog prefer
`build_tcgdex_batches.py` (set-grouped, resumable).

  python scripts/build_tcgdex_index.py --out data/index [--limit 200] [--sets base1,base2]
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

import hnswlib
import httpx
import numpy as np
import open_clip
import torch
from PIL import Image

EMBED_MODEL = "ViT-B-32"
EMBED_PRETRAINED = "openai"
TCGDEX_CARDS = "https://api.tcgdex.net/v2/en/cards"
TCGDEX_SETS = "https://api.tcgdex.net/v2/en/sets"
# TCG Pocket shares the English listing; its art lives under the tcgp series.
POCKET_ASSET_MARKER = "/tcgp/"


def set_id_of(tcgdex_id: str, local_id: str) -> str:
  suffix = f"-{local_id}"
  return tcgdex_id[: -len(suffix)] if local_id and tcgdex_id.endswith(suffix) else tcgdex_id


def _device() -> torch.device:
  if torch.cuda.is_available():
    return torch.device("cuda")
  if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
    return torch.device("mps")
  return torch.device("cpu")


def fetch_json(client: httpx.Client, url: str) -> list[Any]:
  resp = client.get(url)
  resp.raise_for_status()
  body = resp.json()
  if not isinstance(body, list):
    raise SystemExit(f"unexpected TCGdex listing: {url}")
  return body


def eligible_cards(listing: list[Any]) -> list[dict[str, str]]:
  """Non-Pocket English cards that have art, as {tcgdexId, name, setId, image}."""
  cards: list[dict[str, str]] = []
  for card in listing:
    if not isinstance(card, dict):
      continue
    tcgdex_id = str(card.get("id") or "").strip()
    image_base = str(card.get("image") or "").strip().rstrip("/")
    if not tcgdex_id or not image_base or POCKET_ASSET_MARKER in image_base:
      continue
    cards.append(
      {
        "tcgdexId": tcgdex_id,
        "name": str(card.get("name") or "").strip(),
        "setId": set_id_of(tcgdex_id, str(card.get("localId") or "")),
        "image": image_base,
      }
    )
  return cards


def load_model() -> tuple[Any, Any, torch.device]:
  device = _device()
  model, _, preprocess = open_clip.create_model_and_transforms(
    EMBED_MODEL, pretrained=EMBED_PRETRAINED, device=device
  )
  model.eval()
  return model, preprocess, device


def embed_cards(
  client: httpx.Client,
  cards: list[dict[str, str]],
  images: Path,
  model: Any,
  preprocess: Any,
  device: torch.device,
  limit: int = 0,
  label: str = "",
  pause: float = 0.05,
) -> tuple[list[np.ndarray], list[dict[str, str]], list[str]]:
  """Download (cached) + embed. Returns vectors, index rows, and skipped ids.

  `pause` is slept after every download attempt, failed or not.
  """
  images.mkdir(parents=True, exist_ok=True)
  vectors: list[np.ndarray] = []
  rows: list[dict[str, str]] = []
  skipped: list[str] = []
  for card in cards:
    if limit and len(rows) >= limit:
      break
    tcgdex_id = card["tcgdexId"]
    path = images / f"{tcgdex_id}.jpg"
    try:
      if not path.is_file():
        # Some cards (e.g. sv01-021) have low.png but no low.jpg.
        for asset in ("low.jpg", "low.png"):
          try:
            resp = client.get(f"{card['image']}/{asset}")
          finally:
            time.sleep(pause)
          if resp.status_code != 404:
            break
        if resp.status_code != 200:
          skipped.append(tcgdex_id)
          continue
        path.write_bytes(resp.content)
      pil = Image.open(path).convert("RGB")
    except Exception:
      skipped.append(tcgdex_id)
      continue
    with torch.no_grad():
      tensor = preprocess(pil).unsqueeze(0).to(device)
      feats = model.encode_image(tensor)
      feats = feats / feats.norm(dim=-1, keepdim=True)
      vectors.append(feats.cpu().numpy().astype("float32")[0])
      rows.append({"tcgdexId": tcgdex_id, "name": card["name"]})
    if len(rows) % 100 == 0:
      print(f"{label}embedded {len(rows)}…", flush=True)
  return vectors, rows, skipped


def write_index(out: Path, data: np.ndarray, rows: list[dict[str, str]]) -> None:
  out.mkdir(parents=True, exist_ok=True)
  dim = int(data.shape[1])
  index = hnswlib.Index(space="cosine", dim=dim)
  index.init_index(max_elements=len(rows), ef_construction=200, M=32)
  index.add_items(data, np.arange(len(rows)))
  index.set_ef(64)
  index.save_index(str(out / "hnsw.bin"))
  (out / "meta.json").write_text(
    json.dumps(
      {"dim": dim, "model": EMBED_MODEL, "pretrained": EMBED_PRETRAINED, "rows": rows},
      indent=2,
    )
    + "\n"
  )
  print(f"wrote {out} ({len(rows)} cards, dim={dim})")


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--out", type=Path, required=True)
  parser.add_argument("--limit", type=int, default=0, help="Max embedded cards; 0 = all")
  parser.add_argument(
    "--sets", default="", help="Comma-separated TCGdex set ids to include (default: all)"
  )
  args = parser.parse_args()
  set_order = [s.strip() for s in args.sets.split(",") if s.strip()]

  model, preprocess, device = load_model()
  with httpx.Client(timeout=60.0) as client:
    cards = eligible_cards(fetch_json(client, TCGDEX_CARDS))
    if set_order:
      # --limit truncates in --sets order, so earlier sets are indexed in full.
      rank = {s: i for i, s in enumerate(set_order)}
      cards = sorted((c for c in cards if c["setId"] in rank), key=lambda c: rank[c["setId"]])
    vectors, rows, _ = embed_cards(
      client, cards, args.out / "images", model, preprocess, device, limit=args.limit
    )

  if not vectors:
    raise SystemExit("no embeddings")
  write_index(args.out, np.vstack(vectors), rows)


if __name__ == "__main__":
  main()
