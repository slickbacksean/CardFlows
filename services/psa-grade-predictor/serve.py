"""
CardFlow Prepare photo-estimate sidecar for the dual-branch PSA CNN.

Does not vendor https://github.com/jshan9078/PSAGradePredictor (no license +
private training weights). Point PSA_GRADE_UPSTREAM at a local clone of that
repo and PSA_GRADE_CHECKPOINT at phase2_best.pth (or exported state_dict).

Env:
  PSA_GRADE_UPSTREAM     Absolute path to PSAGradePredictor repo root
  PSA_GRADE_CHECKPOINT   Path to .pth weights (required for live inference)
  PSA_GRADE_CONFIG       Optional JSON config next to exported model
  PSA_GRADE_IMAGE_SIZE   Default 384 (Run 7 / README best)
  PSA_GRADE_TOKEN        Optional shared secret; must match CARD_FLOW_PSA_GRADE_TOKEN
  PSA_GRADE_HOST         Default 127.0.0.1
  PSA_GRADE_PORT         Default 8091
  PSA_GRADE_DEVICE       cuda | cpu | mps (default: auto)
"""

from __future__ import annotations

import io
import json
import os
import sys
from pathlib import Path
from typing import Any

import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

UPSTREAM = Path(os.environ.get("PSA_GRADE_UPSTREAM", "")).expanduser()
CHECKPOINT = Path(os.environ.get("PSA_GRADE_CHECKPOINT", "")).expanduser()
CONFIG_PATH = Path(os.environ.get("PSA_GRADE_CONFIG", "")).expanduser()
IMAGE_SIZE = int(os.environ.get("PSA_GRADE_IMAGE_SIZE", "384"))
TOKEN = os.environ.get("PSA_GRADE_TOKEN", "").strip()
HOST = os.environ.get("PSA_GRADE_HOST", "127.0.0.1")
PORT = int(os.environ.get("PSA_GRADE_PORT", "8091"))


def _device() -> torch.device:
  raw = os.environ.get("PSA_GRADE_DEVICE", "").strip().lower()
  if raw in {"cuda", "cpu", "mps"}:
    return torch.device(raw)
  if torch.cuda.is_available():
    return torch.device("cuda")
  if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
    return torch.device("mps")
  return torch.device("cpu")


DEVICE = _device()
app = FastAPI(title="cardflow-psa-grade", docs_url=None, redoc_url=None)
_model: Any = None
_use_coral = True
_ready_error: str | None = "model not loaded"


def _import_upstream() -> tuple[Any, Any, Any, Any]:
  if not UPSTREAM.is_dir():
    raise RuntimeError(
      "PSA_GRADE_UPSTREAM must point at a local clone of "
      "https://github.com/jshan9078/PSAGradePredictor"
    )
  src = str(UPSTREAM / "src")
  if src not in sys.path:
    sys.path.insert(0, src)
  from losses import coral_logits_to_predictions  # type: ignore
  from model import DualBranchPSA  # type: ignore
  from preprocess import lab_preprocess  # type: ignore
  from resize_utils import resize_with_aspect_ratio  # type: ignore

  return DualBranchPSA, lab_preprocess, resize_with_aspect_ratio, coral_logits_to_predictions


def _load_config() -> dict[str, Any]:
  defaults = {
    "lambda_fusion": 0.7,
    "in_channels": 6,
    "front_depth": 18,
    "back_depth": 34,
    "dropout": 0.25,
    "use_rim_mask": True,
    "rim_mask_ratio": 0.07,
    "use_coral": True,
    "num_classes": 10,
  }
  path = CONFIG_PATH if CONFIG_PATH.is_file() else None
  if path is None and CHECKPOINT.is_file():
    sibling = CHECKPOINT.with_name("psa_dual_branch_config.json")
    if sibling.is_file():
      path = sibling
  if path is None:
    return defaults
  with path.open() as handle:
    loaded = json.load(handle)
  if not isinstance(loaded, dict):
    return defaults
  merged = {**defaults, **loaded}
  merged["use_coral"] = bool(merged.get("use_coral", True))
  return merged


def _load_state_dict(path: Path) -> dict[str, torch.Tensor]:
  payload = torch.load(path, map_location="cpu", weights_only=False)
  if isinstance(payload, dict):
    if "model_state_dict" in payload and isinstance(payload["model_state_dict"], dict):
      return payload["model_state_dict"]
    if "state_dict" in payload and isinstance(payload["state_dict"], dict):
      return payload["state_dict"]
    # bare state_dict
    if all(isinstance(k, str) for k in payload.keys()):
      sample = next(iter(payload.values()), None)
      if torch.is_tensor(sample):
        return payload  # type: ignore[return-value]
  raise RuntimeError(f"Unrecognized checkpoint format: {path}")


def load_model() -> None:
  global _model, _use_coral, _ready_error
  try:
    DualBranchPSA, _, _, _ = _import_upstream()
    if not CHECKPOINT.is_file():
      raise RuntimeError(
        "PSA_GRADE_CHECKPOINT must point at phase2_best.pth or exported state_dict"
      )
    cfg = _load_config()
    _use_coral = bool(cfg.get("use_coral", True))
    model = DualBranchPSA(
      lambda_fusion=float(cfg.get("lambda_fusion", 0.7)),
      in_channels=int(cfg.get("in_channels", 6)),
      front_depth=int(cfg.get("front_depth", 18)),
      back_depth=int(cfg.get("back_depth", 34)),
      pretrained=False,
      dropout=float(cfg.get("dropout", 0.25)),
      use_rim_mask=bool(cfg.get("use_rim_mask", True)),
      rim_mask_ratio=float(cfg.get("rim_mask_ratio", 0.07)),
      use_coral=_use_coral,
      num_classes=int(cfg.get("num_classes", 10)),
    )
    state = _load_state_dict(CHECKPOINT)
    model.load_state_dict(state, strict=False)
    model.to(DEVICE)
    model.eval()
    _model = model
    _ready_error = None
  except Exception as exc:  # noqa: BLE001 — surface load errors on /health
    _model = None
    _ready_error = str(exc)


def _decode_upload(data: bytes) -> np.ndarray:
  import cv2

  arr = np.frombuffer(data, dtype=np.uint8)
  image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
  if image is None:
    raise HTTPException(status_code=400, detail="unreadable image")
  return image


def _to_tensor(bgr: np.ndarray, lab_preprocess, resize_with_aspect_ratio) -> torch.Tensor:
  six = lab_preprocess(bgr)
  if six.shape[0] != IMAGE_SIZE or six.shape[1] != IMAGE_SIZE:
    six = resize_with_aspect_ratio(six, target_size=IMAGE_SIZE, pad_value=0)
  tensor = torch.from_numpy(six).permute(2, 0, 1).float().unsqueeze(0)
  return tensor.to(DEVICE)


def _authorize(x_api_key: str | None) -> None:
  if not TOKEN:
    return
  if (x_api_key or "").strip() != TOKEN:
    raise HTTPException(status_code=401, detail="unauthorized")


@app.on_event("startup")
def _startup() -> None:
  load_model()


@app.get("/health")
def health() -> JSONResponse:
  ok = _ready_error is None and _model is not None
  return JSONResponse(
    {
      "ok": ok,
      "service": "cardflow-psa-grade",
      "device": str(DEVICE),
      "imageSize": IMAGE_SIZE,
      "error": _ready_error,
    },
    status_code=200 if ok else 503,
  )


@app.post("/v1/estimate")
async def estimate(
  front: UploadFile = File(...),
  back: UploadFile = File(...),
  x_api_key: str | None = Header(default=None),
) -> JSONResponse:
  _authorize(x_api_key)
  if _model is None or _ready_error is not None:
    raise HTTPException(status_code=503, detail=_ready_error or "model not loaded")

  DualBranchPSA, lab_preprocess, resize_with_aspect_ratio, coral_logits_to_predictions = (
    _import_upstream()
  )
  del DualBranchPSA

  front_bytes = await front.read()
  back_bytes = await back.read()
  if not front_bytes or not back_bytes:
    raise HTTPException(status_code=400, detail="front and back images required")

  front_t = _to_tensor(_decode_upload(front_bytes), lab_preprocess, resize_with_aspect_ratio)
  back_t = _to_tensor(_decode_upload(back_bytes), lab_preprocess, resize_with_aspect_ratio)

  with torch.no_grad():
    outputs = _model(front_t, back_t, return_probs=True)
    logits = outputs["logits"]
    if _use_coral:
      pred_idx = int(coral_logits_to_predictions(logits)[0].item())
      probs = outputs.get("probs")
    else:
      probs = torch.softmax(logits, dim=-1)
      pred_idx = int(logits.argmax(dim=1)[0].item())
    overall = pred_idx + 1  # 0..9 → PSA 1..10
    if probs is not None:
      top_prob = float(torch.clamp(probs[0, pred_idx], min=0.0, max=1.0).item())
    else:
      top_prob = 0.0
    edge_prob = float(torch.sigmoid(outputs["edge_logit"])[0].item())

  if top_prob >= 0.7:
    confidence = "high"
  elif top_prob >= 0.4:
    confidence = "medium"
  else:
    confidence = "low"

  return JSONResponse(
    {
      "overall": overall,
      "confidence": confidence,
      "usedBack": True,
      "mathTrace": [
        f"overall={overall} from dual-branch CNN (CORAL={_use_coral})",
        f"classProb={top_prob:.3f}",
        f"edgeDamageProb={edge_prob:.3f}",
        "pillar subgrades omitted — CNN predicts overall grade only",
      ],
    }
  )


def main() -> None:
  uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
  main()
