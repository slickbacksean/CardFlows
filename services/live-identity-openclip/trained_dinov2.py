"""
PokeSniper trained DINOv2-S + SubCenterArcFace recognizer.

Loads b1_best.pt weights and precomputed catalog embeddings, embeds card crops,
matches by cosine similarity (average of art-crop + full-card scores).

Model: timm vit_small_patch14_dinov2.lvd142m, last 8 blocks + norm unfrozen,
residual head (384->384 linear, zero-init), L2 normalize output.

Env:
  TRAINED_MODEL_WEIGHTS: Path or URL to b1_best.pt PyTorch checkpoint
  TRAINED_MODEL_CAT_FULL: Path or URL to cat_full_b1.npy (float16, shape: [N, 384])
  TRAINED_MODEL_CAT_ART: Path or URL to cat_art_b1.npy (float16, shape: [N, 384])
  TRAINED_MODEL_CAT_IDS: Path or URL to cat_ids.json (list of TCGdex IDs)
  TRAINED_MODEL_ACCEPT: Cosine similarity threshold (default: 0.68)
  TRAINED_MODEL_MARGIN: Min top-1 minus top-2 margin (default: 0.02)
  TRAINED_MODEL_TOPK: Top-K candidates (default: 5)
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import timm
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image

# ImageNet normalization constants
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# Art crop region (fraction of W, H): [x0, y0, x1, y1]
ART_CROP = (0.09, 0.10, 0.91, 0.50)


class ResidualHead(nn.Module):
    """Residual linear head: output = x + A(x), then L2 normalize."""

    def __init__(self, dim: int = 384):
        super().__init__()
        self.A = nn.Linear(dim, dim, bias=False)
        nn.init.zeros_(self.A.weight)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.A(x)
        return F.normalize(x, dim=-1)


class TrainedModel:
    """DINOv2-S + residual head trained recognizer."""

    def __init__(
        self,
        device: torch.device,
        weights_path: Path,
        cat_full: np.ndarray,
        cat_art: np.ndarray,
        cat_ids: list[str],
        card_names: dict[str, str],
        accept: float = 0.68,
        margin: float = 0.02,
        topk: int = 5,
    ):
        self.device = device
        self.accept = accept
        self.margin = margin
        self.topk = topk
        self.cat_ids = cat_ids
        self.card_names = card_names

        # Load model
        self.model = timm.create_model(
            "vit_small_patch14_dinov2.lvd142m",
            pretrained=True,
            num_classes=0,
            img_size=224,
        ).to(device)
        self.model.eval()

        # Load trained weights
        checkpoint = torch.load(weights_path, map_location="cpu", weights_only=True)
        # Load only the trained blocks (last 8 + norm)
        if "blocks" in checkpoint:
            self.model.load_state_dict(checkpoint["blocks"], strict=False)

        # Load residual head
        self.head = ResidualHead(dim=384).to(device)
        if "head" in checkpoint:
            self.head.load_state_dict(checkpoint["head"])
        self.head.eval()

        # Load and normalize catalog embeddings
        self.cat_full = cat_full.astype(np.float32)
        self.cat_art = cat_art.astype(np.float32)

        # L2 normalize catalog embeddings
        self.cat_full = self.cat_full / np.linalg.norm(
            self.cat_full, axis=1, keepdims=True
        ).clip(1e-6)
        self.cat_art = self.cat_art / np.linalg.norm(
            self.cat_art, axis=1, keepdims=True
        ).clip(1e-6)

    def preprocess(self, image: Image.Image, art_crop: bool = False) -> torch.Tensor:
        """
        Preprocess image following train_b1.py:
        1. Optional art crop (0.09, 0.10, 0.91, 0.50)
        2. Resize short side to 224 (bicubic)
        3. Center crop 224x224
        4. Convert RGB, normalize with ImageNet mean/std
        """
        if art_crop:
            w, h = image.size
            x0, y0, x1, y1 = ART_CROP
            image = image.crop(
                (int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h))
            )

        # Resize short side to 224 (bicubic)
        w, h = image.size
        scale = 224 / min(w, h)
        new_w = max(224, round(w * scale))
        new_h = max(224, round(h * scale))
        image = image.resize((new_w, new_h), Image.BICUBIC)

        # Center crop 224x224
        w, h = image.size
        left = (w - 224) // 2
        top = (h - 224) // 2
        image = image.crop((left, top, left + 224, top + 224))

        # Convert to array, RGB, float32
        arr = np.array(image.convert("RGB")).astype(np.float32) / 255.0

        # Normalize with ImageNet mean/std
        arr = (arr - MEAN) / STD

        # Convert to tensor (C, H, W)
        tensor = torch.from_numpy(arr.transpose(2, 0, 1)).float()
        return tensor.unsqueeze(0)  # Add batch dimension

    def embed(self, image: Image.Image, art_crop: bool = False) -> np.ndarray:
        """Embed image: preprocess -> model -> head -> L2 normalize."""
        tensor = self.preprocess(image, art_crop=art_crop).to(self.device)
        with torch.no_grad():
            features = self.model(tensor)  # (1, 384)
            embedding = self.head(features)  # (1, 384) L2-normalized
        return embedding.cpu().numpy().astype(np.float32)

    def match(
        self, image: Image.Image
    ) -> tuple[list[dict[str, Any]], dict[str, float]]:
        """
        Match image against catalog.
        Returns (candidates, timings).

        Scoring: (query @ cat_full + query @ cat_art) / 2
        Name-pooled: max score per card name
        """
        import time

        timings = {}

        # Embed full crop
        start = time.perf_counter()
        emb_full = self.embed(image, art_crop=False).reshape(-1)
        timings["embedFullMs"] = round((time.perf_counter() - start) * 1000, 2)

        # Embed art crop
        start = time.perf_counter()
        emb_art = self.embed(image, art_crop=True).reshape(-1)
        timings["embedArtMs"] = round((time.perf_counter() - start) * 1000, 2)

        # Compute similarities
        start = time.perf_counter()
        sim_full = self.cat_full @ emb_full
        sim_art = self.cat_art @ emb_art
        sim = (sim_full + sim_art) / 2  # Average of both views
        timings["searchMs"] = round((time.perf_counter() - start) * 1000, 2)

        # Name-pooled: max score per name
        name_scores: dict[str, tuple[str, float]] = {}  # name -> (tcgdexId, score)
        for i, tcgdex_id in enumerate(self.cat_ids):
            name = self.card_names.get(tcgdex_id, "").strip().lower()
            if not name:
                continue
            score = float(sim[i])
            if name not in name_scores or score > name_scores[name][1]:
                name_scores[name] = (tcgdex_id, score)

        # Sort by score
        sorted_names = sorted(name_scores.items(), key=lambda x: x[1][1], reverse=True)

        # Build candidates
        candidates = []
        for name, (tcgdex_id, score) in sorted_names[: self.topk]:
            candidates.append(
                {
                    "tcgdexId": tcgdex_id,
                    "name": self.card_names.get(tcgdex_id, ""),
                    "similarity": round(score, 4),
                }
            )

        return candidates, timings


def _download_file(url: str, dest: Path) -> None:
    """Download file from URL to dest path."""
    print(f"[trained_dinov2] Downloading {dest.name}...")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.stream("GET", url, follow_redirects=True, timeout=300) as response:
        response.raise_for_status()
        with dest.open("wb") as f:
            for chunk in response.iter_bytes(chunk_size=8192):
                f.write(chunk)
    print(f"[trained_dinov2] Downloaded {dest.name} ({dest.stat().st_size} bytes)")


def _ensure_file(url_or_path: str, cache_name: str, cache_dir: Path) -> Path:
    """Ensure file exists locally, downloading if needed."""
    if not url_or_path.startswith("http://") and not url_or_path.startswith("https://"):
        # Local path
        local_path = Path(url_or_path).expanduser()
        if not local_path.is_file():
            raise FileNotFoundError(f"Model file not found: {local_path}")
        return local_path

    # URL: download and cache
    cached = cache_dir / cache_name
    if cached.is_file():
        return cached

    _download_file(url_or_path, cached)
    return cached


def _parse_npy(path: Path) -> np.ndarray:
    """Parse NumPy .npy file (simple format: magic + header + data)."""
    with path.open("rb") as f:
        # Read magic + version
        magic = f.read(6)
        if magic != b"\x93NUMPY":
            raise ValueError(f"Invalid .npy magic: {magic}")

        version = f.read(2)
        major, minor = version[0], version[1]

        # Read header length
        if major == 1:
            header_len = int.from_bytes(f.read(2), "little")
        elif major in (2, 3):
            header_len = int.from_bytes(f.read(4), "little")
        else:
            raise ValueError(f"Unsupported .npy version: {major}.{minor}")

        # Read header (Python literal dict)
        header_bytes = f.read(header_len)
        header_str = header_bytes.decode("latin1").strip()
        # Parse header dict (simple eval for now)
        header = eval(header_str.replace("\n", ""))

        # Parse dtype and shape
        dtype_str = header["descr"]
        shape = tuple(header["shape"])
        fortran_order = header.get("fortran_order", False)

        if fortran_order:
            raise ValueError("Fortran-order arrays not supported")

        # Map dtype string to numpy dtype
        dtype_map = {
            "<f2": np.float16,
            "<f4": np.float32,
            "<f8": np.float64,
            ">f2": ">f2",
            ">f4": ">f4",
            ">f8": ">f8",
        }
        dtype = dtype_map.get(dtype_str, np.dtype(dtype_str))

        # Read array data
        data = np.frombuffer(f.read(), dtype=dtype)
        return data.reshape(shape)


def load_trained_model(
    device: torch.device, card_names: dict[str, str]
) -> TrainedModel | None:
    """
    Load trained model from environment variables.

    Returns None if not configured or on error.
    """
    weights_url = os.environ.get("TRAINED_MODEL_WEIGHTS", "").strip()
    cat_full_url = os.environ.get("TRAINED_MODEL_CAT_FULL", "").strip()
    cat_art_url = os.environ.get("TRAINED_MODEL_CAT_ART", "").strip()
    cat_ids_url = os.environ.get("TRAINED_MODEL_CAT_IDS", "").strip()

    if not all([weights_url, cat_full_url, cat_art_url, cat_ids_url]):
        return None

    try:
        cache_dir = Path(os.environ.get("TRAINED_MODEL_CACHE_DIR", ".cache/trained-model")).expanduser()
        cache_dir.mkdir(parents=True, exist_ok=True)

        # Download/load files
        weights_path = _ensure_file(weights_url, "b1_best.pt", cache_dir)
        cat_full_path = _ensure_file(cat_full_url, "cat_full_b1.npy", cache_dir)
        cat_art_path = _ensure_file(cat_art_url, "cat_art_b1.npy", cache_dir)
        cat_ids_path = _ensure_file(cat_ids_url, "cat_ids.json", cache_dir)

        # Load catalog
        print("[trained_dinov2] Loading catalog embeddings...")
        cat_full = _parse_npy(cat_full_path)
        cat_art = _parse_npy(cat_art_path)
        cat_ids = json.loads(cat_ids_path.read_text())

        print(
            f"[trained_dinov2] Loaded catalog: {len(cat_ids)} cards, "
            f"full: {cat_full.shape}, art: {cat_art.shape}"
        )

        # Load model
        accept = float(os.environ.get("TRAINED_MODEL_ACCEPT", "0.68"))
        margin = float(os.environ.get("TRAINED_MODEL_MARGIN", "0.02"))
        topk = int(os.environ.get("TRAINED_MODEL_TOPK", "5"))

        print(f"[trained_dinov2] Loading model on {device}...")
        model = TrainedModel(
            device=device,
            weights_path=weights_path,
            cat_full=cat_full,
            cat_art=cat_art,
            cat_ids=cat_ids,
            card_names=card_names,
            accept=accept,
            margin=margin,
            topk=topk,
        )

        print("[trained_dinov2] Model loaded successfully")
        return model

    except Exception as exc:
        print(f"[trained_dinov2] Failed to load model: {exc}")
        import traceback
        traceback.print_exc()
        return None
