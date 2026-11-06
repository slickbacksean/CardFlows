"""
Three-checkpoint DINOv2 fusion (r18h×2 + d + e) for the PokeSniper ship scanner.

Loads three independent TrainedModel backbones and catalogs, fuses per-ID
cosines as (2*h + d + e)/4, applies OCR boosts, and picks the exact-ID argmax.

The legacy single-model path in trained_dinov2.load_trained_model is unchanged.
If fusion env is incomplete, this module returns None so serve.py can fall back.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import numpy as np

from fusion_score import (
    DEFAULT_ACCEPT,
    DEFAULT_MARGIN,
    DEFAULT_NUM_W,
    DEFAULT_OCR_W,
    MF_GATE,
    CatalogShapeError,
    accept_gate,
    apply_ocr_boosts,
    discover_catx_names,
    expected_catalog_n,
    fuse_similarities,
    fusion_env_complete,
    fusion_files_ready,
    fusion_requested,
    gate_frames,
    load_fusion_arrays,
    merge_card_names,
    parse_fusion_weights,
    path_ready,
    pick_exact_id,
    topk_exact,
)


class FusedTrainedModel:
    """h/d/e DINOv2 fusion matcher. Same match() shape as TrainedModel plus OCR kwargs."""

    pipeline = "trained_dinov2_fusion"

    def __init__(
        self,
        models: dict[str, Any],
        cat_ids: list[str],
        card_names: dict[str, str],
        weights: tuple[float, float, float] = (2.0, 1.0, 1.0),
        accept: float = DEFAULT_ACCEPT,
        margin: float = DEFAULT_MARGIN,
        topk: int = 5,
        ocr_w: float = DEFAULT_OCR_W,
        num_w: float = DEFAULT_NUM_W,
        mf_gate: float = MF_GATE,
        mf_pool: str = "mean",
    ):
        self.models = models  # {"h", "d", "e"}
        self.cat_ids = cat_ids
        self.card_names = card_names
        self.weights = weights
        self.accept = accept
        self.margin = margin
        self.topk = topk
        self.ocr_w = ocr_w
        self.num_w = num_w
        self.mf_gate = mf_gate
        self.mf_pool = mf_pool
        self.last_boosted: np.ndarray | None = None
        self.last_pred: str | None = None

    @property
    def indexed(self) -> int:
        return len(self.cat_ids)

    def _one_frame(self, image: Any) -> tuple[np.ndarray, dict[str, float]]:
        sims: dict[str, np.ndarray] = {}
        timings: dict[str, float] = {"embedFullMs": 0.0, "embedArtMs": 0.0, "searchMs": 0.0}
        for key in ("h", "d", "e"):
            sim, t = self.models[key].view_similarities(image)
            sims[key] = sim
            timings["embedFullMs"] += t.get("embedFullMs", 0.0)
            timings["embedArtMs"] += t.get("embedArtMs", 0.0)
            timings["searchMs"] += t.get("searchMs", 0.0)
        start = time.perf_counter()
        fused = fuse_similarities(sims["h"], sims["d"], sims["e"], self.weights)
        timings["searchMs"] += round((time.perf_counter() - start) * 1000, 2)
        timings["embedFullMs"] = round(timings["embedFullMs"], 2)
        timings["embedArtMs"] = round(timings["embedArtMs"], 2)
        timings["searchMs"] = round(timings["searchMs"], 2)
        return fused, timings

    def score_frames(
        self,
        images: list[Any],
        name_tokens: list[str] | tuple[str, ...] = (),
        collector_tokens: list[str] | tuple[str, ...] = (),
    ) -> tuple[np.ndarray, dict[str, float]]:
        if not images:
            raise ValueError("no images")
        frame_svs: list[np.ndarray] = []
        timings = {"embedFullMs": 0.0, "embedArtMs": 0.0, "searchMs": 0.0}
        for image in images:
            sv, t = self._one_frame(image)
            frame_svs.append(sv)
            for key in timings:
                timings[key] += t.get(key, 0.0)
        start = time.perf_counter()
        if len(frame_svs) == 1:
            sv = frame_svs[0]
        else:
            sv = gate_frames(frame_svs, gate=self.mf_gate, pool=self.mf_pool)
        boosted = apply_ocr_boosts(
            sv,
            self.cat_ids,
            self.card_names,
            name_tokens,
            collector_tokens,
            ocr_w=self.ocr_w,
            num_w=self.num_w,
        )
        timings["searchMs"] += (time.perf_counter() - start) * 1000
        for key in timings:
            timings[key] = round(timings[key], 2)
        self.last_boosted = boosted
        return boosted, timings

    def match(
        self,
        image: Any,
        name_tokens: list[str] | tuple[str, ...] = (),
        collector_tokens: list[str] | tuple[str, ...] = (),
        extra_frames: list[Any] | None = None,
        **_kwargs: Any,
    ) -> tuple[list[dict[str, Any]], dict[str, float]]:
        images = [image, *(extra_frames or [])]
        boosted, timings = self.score_frames(images, name_tokens, collector_tokens)
        pred, _idx, _top, _margin = pick_exact_id(boosted, self.cat_ids)
        self.last_pred = pred
        candidates = topk_exact(boosted, self.cat_ids, self.card_names, topk=self.topk)
        return candidates, timings

    def accepted_from_last(self) -> tuple[bool, str, float | None, float | None]:
        """Accept on original exact-ID fusion scores; similarity is the displayed ID."""
        if self.last_boosted is None or not self.cat_ids:
            return False, "below_threshold", None, None
        _pred, _idx, top, margin = pick_exact_id(self.last_boosted, self.cat_ids)
        ok = accept_gate(top, margin, self.accept, self.margin)
        reason = "accepted" if ok else ("ambiguous" if top >= self.accept else "below_threshold")
        display = top
        if self.last_pred:
            try:
                display = float(self.last_boosted[self.cat_ids.index(self.last_pred)])
            except ValueError:
                pass
        return ok, reason, round(display, 4), round(margin, 4)

    def reorder_candidates(self, candidates: list[dict[str, Any]], new_id: str) -> list[dict[str, Any]]:
        """Put an overridden ID first, using last boosted scores when present."""
        if not new_id:
            return candidates
        self.last_pred = new_id
        score = None
        if self.last_boosted is not None:
            try:
                score = round(float(self.last_boosted[self.cat_ids.index(new_id)]), 4)
            except ValueError:
                score = None
        hit = next((c for c in candidates if c.get("tcgdexId") == new_id), None)
        rest = [c for c in candidates if c.get("tcgdexId") != new_id]
        if hit is None:
            hit = {
                "tcgdexId": new_id,
                "name": self.card_names.get(new_id, ""),
                "similarity": score if score is not None else (candidates[0]["similarity"] if candidates else 0.0),
            }
        elif score is not None:
            hit = {**hit, "similarity": score}
        return [hit, *rest]


def _cache_name(prefix: str, src: str) -> str:
    suffix = Path(src.split("?")[0]).name or prefix
    return f"{prefix}_{suffix}"


def load_fused_model(device: Any, card_names: dict[str, str]) -> FusedTrainedModel | None:
    """
    Load three checkpoints + catalogs when TRAINED_MODEL_FUSION is set.

    Returns None (so serve.py falls back) when:
      - fusion is not requested
      - H/D/E env is incomplete (does not treat TRAINED_MODEL_WEIGHTS as fusion)
      - a local file is missing
      - catalog ID count / shape mismatches
      - any checkpoint fails to load (no 2/3 partial fuse)
    """
    if not fusion_requested():
        return None

    if not fusion_env_complete():
        print(
            "[trained_dinov2_fusion] TRAINED_MODEL_FUSION is set but H/D/E "
            "weight+catalog+CAT_IDS env is incomplete; not treating "
            "TRAINED_MODEL_WEIGHTS as fusion"
        )
        return None

    if not fusion_files_ready():
        missing = [
            key
            for key in (
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
            if not os.environ.get(key, "").strip()
            or not path_ready(os.environ.get(key, ""))
        ]
        print(f"[trained_dinov2_fusion] fusion files not ready: {missing}")
        return None

    # Import torch-backed loader only when we are actually going to load.
    from trained_dinov2 import TrainedModel, _ensure_file

    try:
        cache_dir = Path(os.environ.get("TRAINED_MODEL_CACHE_DIR", ".cache/trained-model")).expanduser()
        cache_dir.mkdir(parents=True, exist_ok=True)

        def ensure(env_key: str, cache: str) -> Path:
            return _ensure_file(os.environ[env_key].strip(), cache, cache_dir)

        paths = {
            "h_w": ensure("TRAINED_MODEL_H_WEIGHTS", _cache_name("h", os.environ["TRAINED_MODEL_H_WEIGHTS"])),
            "d_w": ensure("TRAINED_MODEL_D_WEIGHTS", _cache_name("d", os.environ["TRAINED_MODEL_D_WEIGHTS"])),
            "e_w": ensure("TRAINED_MODEL_E_WEIGHTS", _cache_name("e", os.environ["TRAINED_MODEL_E_WEIGHTS"])),
            "h_full": ensure("TRAINED_MODEL_H_CAT_FULL", "h_cat_full_b1.npy"),
            "h_art": ensure("TRAINED_MODEL_H_CAT_ART", "h_cat_art_b1.npy"),
            "d_full": ensure("TRAINED_MODEL_D_CAT_FULL", "d_cat_full_b1.npy"),
            "d_art": ensure("TRAINED_MODEL_D_CAT_ART", "d_cat_art_b1.npy"),
            "e_full": ensure("TRAINED_MODEL_E_CAT_FULL", "e_cat_full_b1.npy"),
            "e_art": ensure("TRAINED_MODEL_E_CAT_ART", "e_cat_art_b1.npy"),
            "ids": ensure("TRAINED_MODEL_CAT_IDS", "cat_ids.json"),
        }

        cat_ids, _catalogs = load_fusion_arrays(
            paths["ids"],
            [
                paths["h_full"],
                paths["h_art"],
                paths["d_full"],
                paths["d_art"],
                paths["e_full"],
                paths["e_art"],
            ],
            expected_n=expected_catalog_n(),
        )

        catx = discover_catx_names(str(paths["ids"]))
        if catx is None:
            print(
                "[trained_dinov2_fusion] catx_names.json not found next to cat_ids.json; "
                "TG/GG OCR name boosts will miss extra IDs"
            )
        names = merge_card_names(card_names, catx)

        accept = float(os.environ.get("TRAINED_MODEL_ACCEPT", str(DEFAULT_ACCEPT)))
        margin = float(os.environ.get("TRAINED_MODEL_MARGIN", str(DEFAULT_MARGIN)))
        topk = int(os.environ.get("TRAINED_MODEL_TOPK", "5"))
        ocr_w = float(os.environ.get("TRAINED_MODEL_OCR_W", str(DEFAULT_OCR_W)))
        num_w = float(os.environ.get("TRAINED_MODEL_NUM_W", str(DEFAULT_NUM_W)))
        mf_gate = float(os.environ.get("TRAINED_MODEL_MF_GATE", str(MF_GATE)))
        mf_pool = os.environ.get("TRAINED_MODEL_MF_POOL", "mean").strip().lower() or "mean"
        fusion_w = parse_fusion_weights(os.environ.get("TRAINED_MODEL_FUSION_WEIGHTS"))

        num_threads = int(os.environ.get("TRAINED_MODEL_TORCH_THREADS", "1"))
        import torch

        torch.set_num_threads(num_threads)
        print(f"[trained_dinov2_fusion] torch.set_num_threads({num_threads})")

        models: dict[str, Any] = {}
        pairs = (
            ("h", "h_w", "h_full", "h_art"),
            ("d", "d_w", "d_full", "d_art"),
            ("e", "e_w", "e_full", "e_art"),
        )
        for key, w_key, full_key, art_key in pairs:
            print(f"[trained_dinov2_fusion] Loading model {key} on {device}...")
            models[key] = TrainedModel(
                device=device,
                weights_path=paths[w_key],
                cat_full=np.load(str(paths[full_key])),
                cat_art=np.load(str(paths[art_key])),
                cat_ids=cat_ids,
                card_names=names,
                accept=accept,
                margin=margin,
                topk=topk,
            )
        if len(models) != 3:
            print("[trained_dinov2_fusion] refused to start: expected 3 models")
            return None

        fused = FusedTrainedModel(
            models=models,
            cat_ids=cat_ids,
            card_names=names,
            weights=fusion_w,
            accept=accept,
            margin=margin,
            topk=topk,
            ocr_w=ocr_w,
            num_w=num_w,
            mf_gate=mf_gate,
            mf_pool=mf_pool,
        )
        print(
            f"[trained_dinov2_fusion] loaded r18h2de fusion "
            f"n={len(cat_ids)} weights={fusion_w} accept={accept} margin={margin} "
            f"ocr_w={ocr_w} num_w={num_w}"
        )
        return fused
    except CatalogShapeError as exc:
        print(f"[trained_dinov2_fusion] refuse fusion start: {exc}")
        return None
    except Exception as exc:  # noqa: BLE001 — fail closed, no 2/3 fuse
        print(f"[trained_dinov2_fusion] Failed to load fusion (no partial 2/3 fuse): {exc}")
        import traceback

        traceback.print_exc()
        return None
