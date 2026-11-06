"""
Ship fusion scoring math for the PokeSniper DINOv2 scanner.

Fusion: sv = (2*sim_h + 1*sim_d + 1*sim_e) / 4  (weights from env, default 2,1,1)
OCR:    b[i] = sv[i] + 0.15 * 1[name] + 0.10 * 1[collector]
Pick:   exact-ID argmax (not name-pooled)
Accept: b[pred] >= 0.68 and (b[pred] - second) >= 0.02

No torch/timm imports — unit tests run with numpy only.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import numpy as np

EXPECTED_CAT_N = 20339
EXPECTED_DIM = 384
DEFAULT_FUSION_WEIGHTS = (2.0, 1.0, 1.0)  # h, d, e
DEFAULT_OCR_W = 0.15
DEFAULT_NUM_W = 0.10
DEFAULT_ACCEPT = 0.68
DEFAULT_MARGIN = 0.02
MF_GATE = 0.08

FUSION_ENABLE_VALUES = frozenset({"1", "true", "yes", "on", "r18h2de"})

# H/D/E weight + catalog paths. TRAINED_MODEL_WEIGHTS is intentionally absent:
# fusion=1 with only the legacy single-model vars must not silently fuse.
FUSION_FILE_ENVS = (
    "TRAINED_MODEL_H_WEIGHTS",
    "TRAINED_MODEL_D_WEIGHTS",
    "TRAINED_MODEL_E_WEIGHTS",
    "TRAINED_MODEL_H_CAT_FULL",
    "TRAINED_MODEL_H_CAT_ART",
    "TRAINED_MODEL_D_CAT_FULL",
    "TRAINED_MODEL_D_CAT_ART",
    "TRAINED_MODEL_E_CAT_FULL",
    "TRAINED_MODEL_E_CAT_ART",
    "TRAINED_MODEL_CAT_IDS",
)

LEGACY_FILE_ENVS = (
    "TRAINED_MODEL_WEIGHTS",
    "TRAINED_MODEL_CAT_FULL",
    "TRAINED_MODEL_CAT_ART",
    "TRAINED_MODEL_CAT_IDS",
)


class CatalogShapeError(ValueError):
    """Catalog ID count or embedding shape does not match the ship catalog."""


def parse_fusion_weights(raw: str | None) -> tuple[float, float, float]:
    """Parse `h,d,e` weights. Default 2,1,1. Reject wrong arity or non-positive sums."""
    text = (raw or "").strip() or "2,1,1"
    parts = [p.strip() for p in text.split(",") if p.strip()]
    if len(parts) != 3:
        raise ValueError(f"TRAINED_MODEL_FUSION_WEIGHTS must be h,d,e (got {raw!r})")
    weights = tuple(float(p) for p in parts)
    if any(w < 0 for w in weights) or sum(weights) <= 0:
        raise ValueError(f"TRAINED_MODEL_FUSION_WEIGHTS must be non-negative with sum>0 (got {raw!r})")
    return weights[0], weights[1], weights[2]


def fuse_similarities(
    sim_h: np.ndarray,
    sim_d: np.ndarray,
    sim_e: np.ndarray,
    weights: tuple[float, float, float] = DEFAULT_FUSION_WEIGHTS,
) -> np.ndarray:
    """Weighted mean of per-model cosine vectors: (wh*h + wd*d + we*e) / sum(w)."""
    wh, wd, we = weights
    denom = wh + wd + we
    return (wh * sim_h + wd * sim_d + we * sim_e) / denom


def view_similarity(cat_full: np.ndarray, cat_art: np.ndarray, e_full: np.ndarray, e_art: np.ndarray) -> np.ndarray:
    """0.5 * (cat_full @ e_full + cat_art @ e_art). Catalogs and embeddings must be L2-normalized."""
    return 0.5 * (cat_full @ e_full.reshape(-1) + cat_art @ e_art.reshape(-1))


def l2_normalize_rows(mat: np.ndarray) -> np.ndarray:
    out = mat.astype(np.float32, copy=False)
    norms = np.linalg.norm(out, axis=1, keepdims=True).clip(1e-6)
    return out / norms


def l2_normalize_vec(vec: np.ndarray) -> np.ndarray:
    v = vec.astype(np.float32, copy=False).reshape(-1)
    n = float(np.linalg.norm(v))
    return v / max(n, 1e-6)


def normalize_token(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def collector_key(tcgdex_id: str) -> str:
    """Normalized ID suffix (`tcgdexId.split('-')[-1]`)."""
    return normalize_token(tcgdex_id.rsplit("-", 1)[-1])


def apply_ocr_boosts(
    sv: np.ndarray,
    cat_ids: list[str],
    card_names: Mapping[str, str],
    name_tokens: list[str] | tuple[str, ...] | set[str],
    collector_tokens: list[str] | tuple[str, ...] | set[str],
    ocr_w: float = DEFAULT_OCR_W,
    num_w: float = DEFAULT_NUM_W,
) -> np.ndarray:
    """b[i] = sv[i] + ocr_w * 1[name_i in bn] + num_w * 1[num_i in bu]."""
    bn = {normalize_token(t) for t in name_tokens if t}
    bn.discard("")
    bu = {normalize_token(t) for t in collector_tokens if t}
    bu.discard("")
    boosted = np.asarray(sv, dtype=np.float64).copy()
    if not bn and not bu:
        return boosted
    for i, tcgdex_id in enumerate(cat_ids):
        if bn:
            name = normalize_token(card_names.get(tcgdex_id, "") or "")
            if name and name in bn:
                boosted[i] += ocr_w
        if bu:
            num = collector_key(tcgdex_id)
            if num and num in bu:
                boosted[i] += num_w
    return boosted


def pick_exact_id(scores: np.ndarray, cat_ids: list[str]) -> tuple[str, int, float, float]:
    """Exact-ID argmax. Returns (pred_id, index, top_score, margin vs second-best ID)."""
    if len(cat_ids) == 0:
        raise ValueError("empty catalog")
    order = np.argsort(-np.asarray(scores, dtype=np.float64))
    top_i = int(order[0])
    top = float(scores[top_i])
    if len(order) > 1:
        second = float(scores[int(order[1])])
        margin = top - second
    else:
        margin = top
    return cat_ids[top_i], top_i, top, margin


def accept_gate(
    top: float,
    margin: float,
    accept: float = DEFAULT_ACCEPT,
    min_margin: float = DEFAULT_MARGIN,
) -> bool:
    return top >= accept and margin >= min_margin


def gate_frames(
    frame_scores: list[np.ndarray],
    gate: float = MF_GATE,
    pool: str = "mean",
) -> np.ndarray:
    """Drop frames whose best cosine is < max_frame − gate, then mean- or max-pool per ID."""
    if not frame_scores:
        raise ValueError("no frames")
    if len(frame_scores) == 1:
        return np.asarray(frame_scores[0], dtype=np.float64)
    peaks = [float(np.max(s)) for s in frame_scores]
    peak = max(peaks)
    kept = [np.asarray(s, dtype=np.float64) for s, p in zip(frame_scores, peaks) if p >= peak - gate]
    if not kept:
        kept = [np.asarray(s, dtype=np.float64) for s in frame_scores]
    stacked = np.stack(kept, axis=0)
    if pool == "max":
        return stacked.max(axis=0)
    return stacked.mean(axis=0)


def expected_catalog_n(env: Mapping[str, str] | None = None) -> int:
    src = os.environ if env is None else env
    raw = str(src.get("TRAINED_MODEL_CAT_N", "") or "").strip()
    return int(raw) if raw else EXPECTED_CAT_N


def load_fusion_arrays(
    cat_ids_path: str | Path,
    catalog_paths: list[str | Path],
    expected_n: int | None = None,
    dim: int = EXPECTED_DIM,
) -> tuple[list[str], list[np.ndarray]]:
    """Load cat_ids + npy catalogs and refuse on shape mismatch. No torch."""
    cat_ids = json.loads(Path(cat_ids_path).read_text())
    if not isinstance(cat_ids, list) or not all(isinstance(x, str) for x in cat_ids):
        raise CatalogShapeError("cat_ids.json must be a list of strings")
    catalogs = [np.load(str(p)) for p in catalog_paths]
    validate_catalog(cat_ids, catalogs, expected_n=expected_n, dim=dim)
    return cat_ids, catalogs


def validate_catalog(
    cat_ids: list[str],
    catalogs: list[np.ndarray],
    expected_n: int | None = None,
    dim: int = EXPECTED_DIM,
) -> None:
    """Refuse fusion start on ID-count or shape mismatch."""
    n = expected_n if expected_n is not None else expected_catalog_n()
    if len(cat_ids) != n:
        raise CatalogShapeError(
            f"catalog id count {len(cat_ids)} != {n} (ship catalog is {EXPECTED_CAT_N})"
        )
    for i, mat in enumerate(catalogs):
        shape = tuple(mat.shape)
        if len(shape) != 2 or shape[0] != n or shape[1] != dim:
            raise CatalogShapeError(
                f"catalog[{i}] shape {shape} != ({n}, {dim})"
            )


def fusion_requested(env: Mapping[str, str] | None = None) -> bool:
    src = os.environ if env is None else env
    return str(src.get("TRAINED_MODEL_FUSION", "") or "").strip().lower() in FUSION_ENABLE_VALUES


def _env_nonempty(env: Mapping[str, str], keys: tuple[str, ...]) -> bool:
    return all(str(env.get(k, "") or "").strip() for k in keys)


def fusion_env_complete(env: Mapping[str, str] | None = None) -> bool:
    """All H/D/E + CAT_IDS vars set. Legacy TRAINED_MODEL_WEIGHTS does not count."""
    src = os.environ if env is None else env
    return _env_nonempty(src, FUSION_FILE_ENVS)


def legacy_env_complete(env: Mapping[str, str] | None = None) -> bool:
    src = os.environ if env is None else env
    return _env_nonempty(src, LEGACY_FILE_ENVS)


def path_ready(url_or_path: str) -> bool:
    text = (url_or_path or "").strip()
    if not text:
        return False
    if text.startswith("http://") or text.startswith("https://"):
        return True
    return Path(text).expanduser().is_file()


def fusion_files_ready(env: Mapping[str, str] | None = None) -> bool:
    src = os.environ if env is None else env
    if not fusion_env_complete(src):
        return False
    return all(path_ready(str(src.get(k, "") or "")) for k in FUSION_FILE_ENVS)


def legacy_files_ready(env: Mapping[str, str] | None = None) -> bool:
    src = os.environ if env is None else env
    if not legacy_env_complete(src):
        return False
    return all(path_ready(str(src.get(k, "") or "")) for k in LEGACY_FILE_ENVS)


def resolve_pipeline(env: Mapping[str, str] | None = None) -> str:
    """
    Loading order: fusion (only when H/D/E complete) → legacy single → OpenCLIP.

    TRAINED_MODEL_FUSION set with only TRAINED_MODEL_WEIGHTS is not fusion.
    """
    src = os.environ if env is None else env
    if fusion_requested(src):
        if fusion_files_ready(src):
            return "fusion"
        # Incomplete fusion env: fall through. Do not treat WEIGHTS as a 4th fusion model.
    if legacy_files_ready(src):
        return "single"
    return "openclip"


def discover_catx_names(cat_ids_path: str, env: Mapping[str, str] | None = None) -> Path | None:
    src = os.environ if env is None else env
    explicit = str(src.get("TRAINED_MODEL_CATX_NAMES", "") or "").strip()
    if explicit:
        path = Path(explicit).expanduser()
        return path if path.is_file() else None
    ids_path = Path(cat_ids_path).expanduser()
    sibling = ids_path.parent / "catx_names.json"
    return sibling if sibling.is_file() else None


def merge_card_names(
    meta_names: Mapping[str, str],
    catx_path: Path | str | None,
) -> dict[str, str]:
    names = {str(k): str(v) for k, v in dict(meta_names).items()}
    if not catx_path:
        return names
    path = Path(catx_path)
    if not path.is_file():
        return names
    extra = json.loads(path.read_text())
    if not isinstance(extra, dict):
        raise ValueError(f"catx_names.json must be an object, got {type(extra).__name__}")
    for key, value in extra.items():
        if value is None:
            continue
        names[str(key)] = str(value)
    return names


def topk_exact(
    scores: np.ndarray,
    cat_ids: list[str],
    card_names: Mapping[str, str],
    topk: int = 5,
) -> list[dict[str, Any]]:
    """Exact-ID ranked candidates for the match response."""
    k = min(int(topk), len(cat_ids))
    order = np.argsort(-np.asarray(scores, dtype=np.float64))[:k]
    out: list[dict[str, Any]] = []
    for i in order:
        tcgdex_id = cat_ids[int(i)]
        out.append(
            {
                "tcgdexId": tcgdex_id,
                "name": card_names.get(tcgdex_id, ""),
                "similarity": round(float(scores[int(i)]), 4),
            }
        )
    return out
