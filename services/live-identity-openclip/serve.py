"""
CardFlow livestream OpenCLIP identity sidecar.

Inspired by https://github.com/t-sinclair2500/pokemon-scanner (MIT) — OpenCLIP
ViT-B/32 + HNSW cosine search. CardFlow-owned code; do not vendor that tree.
Index rows are English tcgdex_id (TCGdex art), never PokéCollector Gemini.

Env:
  LIVE_IDENTITY_INDEX   Directory with hnsw.bin + meta.json (required for match)
  LIVE_IDENTITY_TOKEN   Optional shared secret; must match API token
  LIVE_IDENTITY_HOST    Default 127.0.0.1
  LIVE_IDENTITY_PORT    Default 8092
  LIVE_IDENTITY_DEVICE  cuda | cpu | mps (default: auto)
  LIVE_IDENTITY_TOPK    Default 5
  LIVE_IDENTITY_ACCEPT  Cosine similarity accept threshold (default 0.86)
  LIVE_IDENTITY_MARGIN  Min top-1 minus top-2 similarity to accept (default 0.02)

Defaults come from scripts/eval_accept.py on the full English index (2026-09-30).
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import hnswlib
import numpy as np
import open_clip
import torch
import uvicorn
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image

from orb_rerank import rerank_near_tie

INDEX_DIR = Path(os.environ.get("LIVE_IDENTITY_INDEX", "")).expanduser()
TOKEN = os.environ.get("LIVE_IDENTITY_TOKEN", "").strip()
HOST = os.environ.get("LIVE_IDENTITY_HOST", "127.0.0.1")
PORT = int(os.environ.get("LIVE_IDENTITY_PORT", "8092"))
TOPK = int(os.environ.get("LIVE_IDENTITY_TOPK", "5"))
ACCEPT = float(os.environ.get("LIVE_IDENTITY_ACCEPT", "0.86"))
MARGIN = float(os.environ.get("LIVE_IDENTITY_MARGIN", "0.02"))
# Capture stills of a physical card sit below the livestream gate. A printed name
# limits the search to that Pokémon's prints, where 0.74 + the same margin separates them.
NAME_ACCEPT = float(os.environ.get("LIVE_IDENTITY_NAME_ACCEPT", "0.74"))
EMBED_MODEL = "ViT-B-32"
EMBED_PRETRAINED = "openai"

app = FastAPI(title="cardflow-live-identity-openclip", docs_url=None, redoc_url=None)

_model: Any = None
_preprocess: Any = None
_index: hnswlib.Index | None = None
_meta: list[dict[str, Any]] = []
_ready_error: str | None = "model not loaded"
_dim = 512
_match_ms: list[float] = []
_MATCH_MS_CAP = 64


def _device() -> torch.device:
  raw = os.environ.get("LIVE_IDENTITY_DEVICE", "").strip().lower()
  if raw in {"cuda", "cpu", "mps"}:
    return torch.device(raw)
  if torch.cuda.is_available():
    return torch.device("cuda")
  if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
    return torch.device("mps")
  return torch.device("cpu")


DEVICE = _device()


def _load() -> None:
  global _model, _preprocess, _index, _meta, _ready_error, _dim
  try:
    model, _, preprocess = open_clip.create_model_and_transforms(
      EMBED_MODEL, pretrained=EMBED_PRETRAINED, device=DEVICE
    )
    model.eval()
    _model = model
    _preprocess = preprocess

    if not INDEX_DIR.is_dir():
      _ready_error = "LIVE_IDENTITY_INDEX missing"
      return
    meta_path = INDEX_DIR / "meta.json"
    bin_path = INDEX_DIR / "hnsw.bin"
    if not meta_path.is_file() or not bin_path.is_file():
      _ready_error = "index files missing (hnsw.bin + meta.json)"
      return
    meta = json.loads(meta_path.read_text())
    rows = meta.get("rows") if isinstance(meta, dict) else None
    if not isinstance(rows, list) or not rows:
      _ready_error = "meta.json has no rows"
      return
    dim = int(meta.get("dim") or _dim)
    index = hnswlib.Index(space="cosine", dim=dim)
    index.load_index(str(bin_path))
    # ef=64 missed the true neighbor on phone stills (~20k cards).
    index.set_ef(max(200, TOPK * 16))
    _index = index
    _meta = rows
    _dim = dim
    _ready_error = None
  except Exception as exc:  # noqa: BLE001 — surface boot error on /health
    _ready_error = str(exc)


@app.on_event("startup")
def startup() -> None:
  _load()


def _check_token(authorization: str | None, x_token: str | None) -> None:
  if not TOKEN:
    return
  presented = (x_token or "").strip()
  if not presented and authorization:
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
      presented = parts[1].strip()
  if presented != TOKEN:
    raise HTTPException(status_code=401, detail="unauthorized")


def _note_match_ms(elapsed_ms: float) -> None:
  _match_ms.append(elapsed_ms)
  if len(_match_ms) > _MATCH_MS_CAP:
    del _match_ms[: len(_match_ms) - _MATCH_MS_CAP]


def _percentile_ms(pct: float) -> float | None:
  if not _match_ms:
    return None
  ordered = sorted(_match_ms)
  index = int(round((pct / 100) * (len(ordered) - 1)))
  index = min(len(ordered) - 1, max(0, index))
  return round(ordered[index], 1)


def _embed(image: Image.Image) -> np.ndarray:
  assert _model is not None and _preprocess is not None
  with torch.no_grad():
    tensor = _preprocess(image.convert("RGB")).unsqueeze(0).to(DEVICE)
    feats = _model.encode_image(tensor)
    feats = feats / feats.norm(dim=-1, keepdim=True)
  return feats.cpu().numpy().astype("float32")


@app.get("/health")
def health() -> JSONResponse:
  body = {
    "ok": _ready_error is None,
    "service": "cardflow-live-identity-openclip",
    "pipeline": "openclip_hnsw",
    "model": EMBED_MODEL,
    "device": str(DEVICE),
    "indexed": len(_meta),
    "accept": ACCEPT,
    "margin": MARGIN,
    "orb": "fail_soft",
    "matchSamples": len(_match_ms),
    "matchP50Ms": _percentile_ms(50),
    "matchP95Ms": _percentile_ms(95),
    "error": _ready_error,
  }
  return JSONResponse(body, status_code=200 if _ready_error is None else 503)


def _candidates_from_pairs(
  pairs: list[tuple[int, float]],
) -> list[dict[str, Any]]:
  candidates: list[dict[str, Any]] = []
  for label, similarity in pairs:
    if label < 0 or label >= len(_meta):
      continue
    row = _meta[label]
    candidates.append(
      {
        "tcgdexId": row.get("tcgdexId"),
        "name": row.get("name"),
        "similarity": round(similarity, 4),
      }
    )
  return candidates


def _rank_named_prints(query: np.ndarray, name: str) -> list[dict[str, Any]]:
  """Exact name match, brute-force cosine. HNSW cannot filter by name."""
  assert _index is not None
  needle = name.strip().lower()
  labels = [
    index
    for index, row in enumerate(_meta)
    if str(row.get("name") or "").strip().lower() == needle
  ]
  if not labels:
    return []
  raw = np.asarray(_index.get_items(labels), dtype=np.float32)
  if raw.ndim == 1:
    raw = raw.reshape(1, -1)
  norms = np.linalg.norm(raw, axis=1, keepdims=True)
  raw = raw / np.clip(norms, 1e-6, None)
  vector = query.reshape(-1).astype(np.float32)
  vector = vector / max(float(np.linalg.norm(vector)), 1e-6)
  sims = raw @ vector
  order = np.argsort(-sims)
  pairs = [(labels[int(slot)], float(sims[int(slot)])) for slot in order[: max(TOPK, 2)]]
  return _candidates_from_pairs(pairs)


def _maybe_rerank(
  image: Image.Image,
  candidates: list[dict[str, Any]],
  accept_at: float,
) -> tuple[list[dict[str, Any]], str]:
  """ORB only on a cosine near-tie. Clear winners and misses stay cosine-only."""
  if len(candidates) < 2:
    return candidates, "cosine"
  top = float(candidates[0]["similarity"])
  second = float(candidates[1]["similarity"])
  if top < accept_at - 0.04:
    return candidates, "cosine"
  if top - second >= max(MARGIN, 0.04):
    return candidates, "cosine"
  return rerank_near_tie(image, candidates, INDEX_DIR)


@app.post("/v1/match")
async def match(
  crop: UploadFile = File(...),
  name: str | None = Form(default=None),
  authorization: str | None = Header(default=None),
  x_cardflow_token: str | None = Header(default=None, alias="X-CardFlow-Token"),
) -> JSONResponse:
  _check_token(authorization, x_cardflow_token)
  if _ready_error or _index is None or _model is None:
    raise HTTPException(status_code=503, detail=_ready_error or "not ready")

  raw = await crop.read()
  if not raw or len(raw) > 8_000_000:
    raise HTTPException(status_code=400, detail="crop too large or empty")
  try:
    image = Image.open(__import__("io").BytesIO(raw))
    image.load()
  except Exception as exc:  # noqa: BLE001
    raise HTTPException(status_code=400, detail=f"invalid image: {exc}") from exc

  started = time.perf_counter()
  query = _embed(image)
  name_hint = (name or "").strip()
  if name_hint:
    candidates = _rank_named_prints(query, name_hint)
    accept_at = NAME_ACCEPT
  else:
    labels, distances = _index.knn_query(query, k=min(max(TOPK, 2), len(_meta)))
    # hnswlib cosine space returns distance = 1 - cosine_similarity
    pairs = [
      (int(label), float(1.0 - distance))
      for label, distance in zip(labels[0].tolist(), distances[0].tolist(), strict=False)
    ]
    candidates = _candidates_from_pairs(pairs)
    accept_at = ACCEPT

  candidates, orb_mode = _maybe_rerank(image, candidates, accept_at)
  top = candidates[0] if candidates else None
  runner_up = float(candidates[1]["similarity"]) if len(candidates) > 1 else 0.0
  margin = round(float(top["similarity"]) - runner_up, 4) if top else None
  if not top or not top.get("tcgdexId") or float(top["similarity"]) < accept_at:
    reason = "below_threshold"
  elif orb_mode == "orb":
    reason = "accepted"
  elif margin is not None and margin < MARGIN:
    # Near-ties are mostly same-art reprints from other sets; a wrong set is worse than none.
    reason = "ambiguous"
  else:
    reason = "accepted"
  accepted = reason == "accepted"
  _note_match_ms((time.perf_counter() - started) * 1000)
  return JSONResponse(
    {
      "ok": True,
      "pipeline": "openclip_hnsw",
      "accepted": accepted,
      "reason": reason,
      "orb": orb_mode,
      "tcgdexId": top["tcgdexId"] if accepted else None,
      "similarity": top["similarity"] if top else None,
      "margin": margin,
      "candidates": candidates[:TOPK],
    }
  )


if __name__ == "__main__":
  uvicorn.run(app, host=HOST, port=PORT, log_level="info")
