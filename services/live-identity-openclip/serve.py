"""
PokeSniper livestream identity sidecar: DINOv2 fusion, single DINOv2, or OpenCLIP.

Primary (ship): r18h×2 + d + e fusion when TRAINED_MODEL_FUSION and H/D/E vars are set.
Rollback:      single TRAINED_MODEL_WEIGHTS / _CAT_* (accept 0.68, margin 0.02 unchanged).
Fallback:      OpenCLIP ViT-B/32 + HNSW cosine search.

Env (ship fusion): TRAINED_MODEL_FUSION, TRAINED_MODEL_{H,D,E}_WEIGHTS,
  TRAINED_MODEL_{H,D,E}_CAT_FULL/_ART, TRAINED_MODEL_CAT_IDS,
  TRAINED_MODEL_FUSION_WEIGHTS=2,1,1, TRAINED_MODEL_OCR_W=0.15,
  TRAINED_MODEL_NUM_W=0.10, TRAINED_MODEL_ACCEPT=0.68, TRAINED_MODEL_MARGIN=0.02.

Env (printing reranker): PRINT_RERANK_ENABLED, PRINT_RERANK_MODEL, PRINT_RERANK_FAM,
  PRINT_RERANK_HR_CAT, PRINT_RERANK_THRESHOLD=0.9, PRINT_RERANK_TOPK_SAME_NAME=6.

Env (legacy single-model): TRAINED_MODEL_WEIGHTS, _CAT_FULL, _CAT_ART, _CAT_IDS.

Env (OpenCLIP fallback):
  LIVE_IDENTITY_INDEX       Directory with hnsw.bin + meta.json
  LIVE_IDENTITY_TOKEN       Optional shared secret; must match API token
  LIVE_IDENTITY_HOST        Default 127.0.0.1
  LIVE_IDENTITY_PORT        Default 8092
  LIVE_IDENTITY_DEVICE      cuda | cpu | mps (default: auto)
  LIVE_IDENTITY_TOPK        Default 5
  LIVE_IDENTITY_ACCEPT      Cosine similarity accept threshold (default 0.86)
  LIVE_IDENTITY_MARGIN      Min top-1 minus top-2 similarity to accept (default 0.02)
  LIVE_IDENTITY_WARP        1 (default) straightens crop; 0 = old crop only
  LIVE_IDENTITY_LIVE_FLOOR  Lower similarity when winner is clearly ahead (default 0.80)
  LIVE_IDENTITY_LIVE_FLOOR_MARGIN  Margin required for floor (default 0.045)
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
from warp import warp_card
from trained_dinov2 import load_trained_model, TrainedModel
from trained_dinov2_fusion import FusedTrainedModel, load_fused_model
from printing_rerank import load_print_reranker, PrintReranker

INDEX_DIR = Path(os.environ.get("LIVE_IDENTITY_INDEX", "")).expanduser()
TOKEN = os.environ.get("LIVE_IDENTITY_TOKEN", "").strip()
HOST = os.environ.get("LIVE_IDENTITY_HOST", "127.0.0.1")
PORT = int(os.environ.get("LIVE_IDENTITY_PORT", "8092"))
TOPK = int(os.environ.get("LIVE_IDENTITY_TOPK", "5"))
ACCEPT = float(os.environ.get("LIVE_IDENTITY_ACCEPT", "0.86"))
MARGIN = float(os.environ.get("LIVE_IDENTITY_MARGIN", "0.02"))
# Stream crops of a physical card score under the catalog gate. Accept them only
# when the winner is clearly ahead of the next candidate.
LIVE_FLOOR = float(os.environ.get("LIVE_IDENTITY_LIVE_FLOOR", "0.80"))
LIVE_FLOOR_MARGIN = float(os.environ.get("LIVE_IDENTITY_LIVE_FLOOR_MARGIN", "0.045"))
# Capture stills of a physical card sit below the livestream gate. A printed name
# limits the search to that Pokémon's prints, where 0.74 + the same margin separates them.
NAME_ACCEPT = float(os.environ.get("LIVE_IDENTITY_NAME_ACCEPT", "0.74"))
WARP = os.environ.get("LIVE_IDENTITY_WARP", "1").strip() != "0"
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
_trained_model: TrainedModel | FusedTrainedModel | None = None
_print_rerank: PrintReranker | None = None
_pipeline: str = "unknown"


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


def _load_meta_names() -> tuple[dict[str, Any] | None, dict[str, str]]:
  """Optional OpenCLIP meta.json names. Fusion can start without hnsw.bin."""
  if not INDEX_DIR.is_dir():
    return None, {}
  meta_path = INDEX_DIR / "meta.json"
  if not meta_path.is_file():
    return None, {}
  meta = json.loads(meta_path.read_text())
  rows = meta.get("rows") if isinstance(meta, dict) else None
  if not isinstance(rows, list) or not rows:
    return meta if isinstance(meta, dict) else None, {}
  names = {row["tcgdexId"]: row.get("name", "") for row in rows if isinstance(row, dict) and row.get("tcgdexId")}
  return meta if isinstance(meta, dict) else None, names


def _attach_reranker(card_names: dict[str, str]) -> None:
  global _print_rerank
  _print_rerank = load_print_reranker(card_names=card_names)
  if _print_rerank is None:
    print("[serve] printing reranker off or unavailable (fusion-only / skip)")


def _load() -> None:
  global _model, _preprocess, _index, _meta, _ready_error, _dim, _trained_model, _pipeline, _print_rerank
  try:
    meta, card_names = _load_meta_names()
    if meta and isinstance(meta.get("rows"), list) and meta["rows"]:
      _meta = meta["rows"]

    fused = load_fused_model(DEVICE, card_names)
    if fused is not None:
      _trained_model = fused
      _pipeline = fused.pipeline
      _ready_error = None
      _attach_reranker(fused.card_names)
      print(
        f"[serve] Using DINOv2 fusion pipeline (accept={fused.accept}, margin={fused.margin}, "
        f"n={fused.indexed}, rerank={_print_rerank is not None})"
      )
      return

    trained = load_trained_model(DEVICE, card_names)
    if trained is not None:
      _trained_model = trained
      _pipeline = "trained_dinov2"
      _ready_error = None
      _attach_reranker(card_names)
      print(f"[serve] Using trained DINOv2-S pipeline (accept={trained.accept}, margin={trained.margin})")
      return

    print("[serve] Trained model not configured, falling back to OpenCLIP")
    if not INDEX_DIR.is_dir():
      _ready_error = "LIVE_IDENTITY_INDEX missing"
      return
    if meta is None:
      _ready_error = "index meta.json missing"
      return
    rows = meta.get("rows") if isinstance(meta, dict) else None
    if not isinstance(rows, list) or not rows:
      _ready_error = "meta.json has no rows"
      return
    _meta = rows
    model, _, preprocess = open_clip.create_model_and_transforms(
      EMBED_MODEL, pretrained=EMBED_PRETRAINED, device=DEVICE
    )
    model.eval()
    _model = model
    _preprocess = preprocess

    bin_path = INDEX_DIR / "hnsw.bin"
    if not bin_path.is_file():
      _ready_error = "index hnsw.bin missing"
      return
    dim = int(meta.get("dim") or _dim)
    index = hnswlib.Index(space="cosine", dim=dim)
    index.load_index(str(bin_path))
    # ef=64 missed the true neighbor on phone stills (~20k cards).
    index.set_ef(max(200, TOPK * 16))
    _index = index
    _dim = dim
    _pipeline = "openclip_hnsw"
    _ready_error = None
    print(f"[serve] Using OpenCLIP pipeline (accept={ACCEPT}, margin={MARGIN})")
  except Exception as exc:  # noqa: BLE001 — surface boot error on /health
    _ready_error = str(exc)
    import traceback
    traceback.print_exc()


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
  """Liveness + model status.

  Always returns HTTP 200 when no trained/OpenCLIP models are loaded so a
  fresh Railway deploy can pass the healthcheck before the ship bundle is
  uploaded to the volume. Callers must read `ok` / `modelsPresent` /
  `fusionLoaded` / `printRerank` for readiness — do not treat 200 alone as
  "recognition is live". Unexpected load failures with a partial pipeline
  still return 503.
  """
  fusion = isinstance(_trained_model, FusedTrainedModel)
  models_present = _trained_model is not None or _index is not None
  if _trained_model:
    body = {
      "ok": _ready_error is None,
      "ready": _ready_error is None,
      "modelsPresent": True,
      "fusionLoaded": fusion,
      "service": "cardflow-live-identity",
      "pipeline": _pipeline,
      "model": "dinov2_s_r18h2de" if fusion else "dinov2_s_subcenter_arcface",
      "device": str(DEVICE),
      "indexed": getattr(_trained_model, "indexed", None) or len(getattr(_trained_model, "cat_ids", _meta)),
      "accept": _trained_model.accept,
      "margin": _trained_model.margin,
      "printRerank": _print_rerank is not None,
      "orb": "not_applicable",
      "warp": WARP,
      "matchSamples": len(_match_ms),
      "matchP50Ms": _percentile_ms(50),
      "matchP95Ms": _percentile_ms(95),
      "error": _ready_error,
    }
  else:
    body = {
      "ok": _ready_error is None,
      "ready": _ready_error is None,
      "modelsPresent": _index is not None,
      "fusionLoaded": False,
      "service": "cardflow-live-identity",
      "pipeline": _pipeline,
      "model": EMBED_MODEL,
      "device": str(DEVICE),
      "indexed": len(_meta),
      "accept": ACCEPT,
      "margin": MARGIN,
      "liveFloor": LIVE_FLOOR,
      "liveFloorMargin": LIVE_FLOOR_MARGIN,
      "printRerank": _print_rerank is not None,
      "orb": "fail_soft",
      "warp": WARP,
      "matchSamples": len(_match_ms),
      "matchP50Ms": _percentile_ms(50),
      "matchP95Ms": _percentile_ms(95),
      "error": _ready_error,
    }
  # Boot without models: 200 so Railway can finish the first deploy before
  # the volume upload. Never log secrets here.
  if not models_present:
    body["ok"] = False
    body["ready"] = False
    body["modelsPresent"] = False
    body["fusionLoaded"] = False
    body["printRerank"] = False
    if not body.get("error"):
      body["error"] = "models not loaded; mount /data/trained-model/bundle and set TRAINED_MODEL_*"
    return JSONResponse(body, status_code=200)
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


def _near_tie_same_name(candidates: list[dict[str, Any]]) -> bool:
  """Same Pokémon across a set reprint tie. A live guess can use the top print."""
  if len(candidates) < 2:
    return False
  top = float(candidates[0]["similarity"])
  names: list[str] = []
  for candidate in candidates:
    if top - float(candidate["similarity"]) > MARGIN:
      break
    name = str(candidate.get("name") or "").strip().lower()
    if not name:
      return False
    names.append(name)
  return len(names) >= 2 and len(set(names)) == 1


def _match_reason(
  candidates: list[dict[str, Any]],
  accept_at: float,
  margin: float | None,
  orb_mode: str,
) -> str:
  top = candidates[0] if candidates else None
  if not top or not top.get("tcgdexId"):
    return "below_threshold"
  similarity = float(top["similarity"])
  if similarity < accept_at:
    if similarity >= LIVE_FLOOR and margin is not None and margin >= LIVE_FLOOR_MARGIN:
      return "accepted"
    return "below_threshold"
  if orb_mode == "orb":
    return "accepted"
  if margin is not None and margin < MARGIN:
    return "accepted" if _near_tie_same_name(candidates) else "ambiguous"
  return "accepted"


def _name_hints(name: str | None, names: str | None) -> list[str]:
  """Up to three OCR guesses. One embedding is scored against each."""
  hints: list[str] = []
  if names:
    hints.extend(part.strip() for part in names.split("\n") if part.strip())
  elif name and name.strip():
    hints.append(name.strip())
  unique: list[str] = []
  for hint in hints:
    if hint.lower() not in {item.lower() for item in unique}:
      unique.append(hint)
  return unique[:3]


def _number_hints(number: str | None, numbers: str | None) -> list[str]:
  hints: list[str] = []
  if numbers:
    hints.extend(part.strip() for part in numbers.replace(",", "\n").split("\n") if part.strip())
  elif number and number.strip():
    hints.append(number.strip())
  unique: list[str] = []
  for hint in hints:
    if hint.lower() not in {item.lower() for item in unique}:
      unique.append(hint)
  return unique


def _apply_print_rerank(
  image: Image.Image,
  candidates: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
  if _print_rerank is None or not candidates:
    return candidates, None
  pred = str(candidates[0].get("tcgdexId") or "")
  if not pred:
    return candidates, None
  names = getattr(_trained_model, "card_names", {}) if _trained_model else {}
  new_id, info = _print_rerank.maybe_override([image], pred, card_names=names)
  if not new_id or new_id == pred:
    return candidates, info
  if isinstance(_trained_model, FusedTrainedModel):
    return _trained_model.reorder_candidates(candidates, new_id), info
  hit = next((c for c in candidates if c.get("tcgdexId") == new_id), None)
  rest = [c for c in candidates if c.get("tcgdexId") != new_id]
  if hit is None:
    hit = {"tcgdexId": new_id, "name": names.get(new_id, ""), "similarity": candidates[0].get("similarity")}
  return [hit, *rest], info


@app.post("/v1/match")
async def match(
  crop: UploadFile = File(...),
  name: str | None = Form(default=None),
  quad: str | None = Form(default=None),
  names: str | None = Form(default=None),
  number: str | None = Form(default=None),
  numbers: str | None = Form(default=None),
  authorization: str | None = Header(default=None),
  x_cardflow_token: str | None = Header(default=None, alias="X-CardFlow-Token"),
) -> JSONResponse:
  _check_token(authorization, x_cardflow_token)
  if _ready_error:
    raise HTTPException(status_code=503, detail=_ready_error or "not ready")
  if not _trained_model and (not _index or not _model):
    raise HTTPException(status_code=503, detail="model not loaded")

  received = time.perf_counter()
  raw = await crop.read()
  if not raw or len(raw) > 8_000_000:
    raise HTTPException(status_code=400, detail="crop too large or empty")
  try:
    image = Image.open(__import__("io").BytesIO(raw))
    image.load()
  except Exception as exc:  # noqa: BLE001
    raise HTTPException(status_code=400, detail=f"invalid image: {exc}") from exc

  decoded = time.perf_counter()
  warped = False
  if WARP and quad:
    straightened = warp_card(image, quad)
    if straightened is not None:
      image = straightened
      warped = True
  started = time.perf_counter()
  
  # Use trained model if available (fusion or legacy single)
  if _trained_model:
    name_tokens = _name_hints(name, names)
    collector_tokens = _number_hints(number, numbers)
    candidates, embed_timings = _trained_model.match(
      image, name_tokens=name_tokens, collector_tokens=collector_tokens
    )
    rerank_started = time.perf_counter()
    candidates, _rerank_info = _apply_print_rerank(image, candidates)
    rerank_ms = round((time.perf_counter() - rerank_started) * 1000, 2)
    accept_at = _trained_model.accept
    margin_threshold = _trained_model.margin
    orb_mode = "not_applicable"
    finished = time.perf_counter()
    _note_match_ms((finished - started) * 1000)
    
    top = candidates[0] if candidates else None
    runner_up = float(candidates[1]["similarity"]) if len(candidates) > 1 else 0.0
    margin = round(float(top["similarity"]) - runner_up, 4) if top else None
    
    # Exact-ID accept for fusion (last boosted vector); name-pooled for legacy.
    accepted = False
    reason = "below_threshold"
    if isinstance(_trained_model, FusedTrainedModel) and _trained_model.last_boosted is not None:
      accepted, reason, sim, margin = _trained_model.accepted_from_last()
      if top is not None and sim is not None:
        top = {**top, "similarity": sim}
        candidates[0] = top
    elif top and margin is not None:
      if float(top["similarity"]) >= accept_at and margin >= margin_threshold:
        accepted = True
        reason = "accepted"
      elif float(top["similarity"]) >= accept_at:
        reason = "ambiguous"
    
    def ms(a: float, b: float) -> float:
      return round((b - a) * 1000, 2)
    
    timings = {
      "decodeMs": ms(received, decoded),
      "warpMs": ms(decoded, started),
      **embed_timings,
      "orbMs": 0.0,
      "rerankMs": rerank_ms,
      "totalMs": ms(received, finished),
    }
    return JSONResponse(
      {
        "ok": True,
        "pipeline": _pipeline,
        "accepted": accepted,
        "reason": reason,
        "orb": orb_mode,
        "tcgdexId": top["tcgdexId"] if accepted else None,
        "similarity": top["similarity"] if top else None,
        "margin": margin,
        "warped": warped,
        "timings": timings,
        "candidates": candidates,
      }
    )
  
  # OpenCLIP fallback
  query = _embed(image)
  embedded = time.perf_counter()
  hints = _name_hints(name, names)
  if hints:
    candidates = []
    accept_at = NAME_ACCEPT
    for hint in hints:
      ranked = _rank_named_prints(query, hint)
      if not ranked:
        continue
      candidates = ranked
      top_try = candidates[0]
      if top_try.get("tcgdexId") and float(top_try["similarity"]) >= accept_at:
        break
  else:
    labels, distances = _index.knn_query(query, k=min(max(TOPK, 2), len(_meta)))
    # hnswlib cosine space returns distance = 1 - cosine_similarity
    pairs = [
      (int(label), float(1.0 - distance))
      for label, distance in zip(labels[0].tolist(), distances[0].tolist(), strict=False)
    ]
    candidates = _candidates_from_pairs(pairs)
    accept_at = ACCEPT
  searched = time.perf_counter()

  candidates, orb_mode = _maybe_rerank(image, candidates, accept_at)
  top = candidates[0] if candidates else None
  runner_up = float(candidates[1]["similarity"]) if len(candidates) > 1 else 0.0
  margin = round(float(top["similarity"]) - runner_up, 4) if top else None
  reason = _match_reason(candidates, accept_at, margin, orb_mode)
  accepted = reason == "accepted"
  finished = time.perf_counter()
  _note_match_ms((finished - started) * 1000)

  def ms(a: float, b: float) -> float:
    return round((b - a) * 1000, 2)

  timings = {
    "decodeMs": ms(received, decoded),
    "warpMs": ms(decoded, started),
    "embedMs": ms(started, embedded),
    "searchMs": ms(embedded, searched),
    "orbMs": ms(searched, finished),
    "totalMs": ms(received, finished),
  }
  return JSONResponse(
    {
      "ok": True,
      "pipeline": _pipeline,
      "accepted": accepted,
      "reason": reason,
      "orb": orb_mode,
      "tcgdexId": top["tcgdexId"] if accepted else None,
      "similarity": top["similarity"] if top else None,
      "margin": margin,
      "warped": warped,
      "timings": timings,
      "candidates": candidates[:TOPK],
    }
  )


if __name__ == "__main__":
  uvicorn.run(app, host=HOST, port=PORT, log_level="info")
