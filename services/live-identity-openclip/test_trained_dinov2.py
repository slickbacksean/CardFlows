"""
Test trained_dinov2.py with a tiny random model (no real weights needed).
"""

import json
import tempfile
from pathlib import Path

import numpy as np
import pytest
import torch
import torch.nn as nn
from PIL import Image

from trained_dinov2 import (
    ResidualHead,
    TrainedModel,
    load_trained_model,
)


def test_residual_head():
    """Test residual head initialization and forward pass."""
    head = ResidualHead(dim=384)
    # Check zero init
    assert torch.allclose(head.A.weight, torch.zeros(384, 384))
    
    # Test forward
    x = torch.randn(1, 384)
    out = head(x)
    assert out.shape == (1, 384)
    # Check L2 normalized
    assert torch.allclose(torch.norm(out, dim=-1), torch.ones(1), atol=1e-5)


def _create_tiny_checkpoint(dim: int = 384) -> dict:
    """Create a minimal checkpoint dict (no actual DINOv2 weights)."""
    head = ResidualHead(dim=dim)
    return {
        "blocks": {},  # Empty - we'll use pretrained DINOv2 base
        "head": head.state_dict(),
        "arcface": False,
    }


def test_trained_model_init():
    """Test TrainedModel initialization with tiny random catalog."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create tiny catalog
        n_cards = 10
        cat_full = np.random.randn(n_cards, 384).astype(np.float16)
        cat_art = np.random.randn(n_cards, 384).astype(np.float16)
        cat_ids = [f"base1-{i}" for i in range(n_cards)]
        card_names = {cid: f"Card {i}" for i, cid in enumerate(cat_ids)}
        
        # Save checkpoint
        ckpt_path = Path(tmpdir) / "tiny.pt"
        torch.save(_create_tiny_checkpoint(), ckpt_path)
        
        # Load model
        device = torch.device("cpu")
        model = TrainedModel(
            device=device,
            weights_path=ckpt_path,
            cat_full=cat_full,
            cat_art=cat_art,
            cat_ids=cat_ids,
            card_names=card_names,
            accept=0.68,
            margin=0.02,
            topk=5,
        )
        
        assert model.accept == 0.68
        assert model.margin == 0.02
        assert model.topk == 5
        assert len(model.cat_ids) == n_cards


def test_trained_model_preprocess():
    """Test image preprocessing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        n_cards = 5
        cat_full = np.random.randn(n_cards, 384).astype(np.float16)
        cat_art = np.random.randn(n_cards, 384).astype(np.float16)
        cat_ids = [f"base1-{i}" for i in range(n_cards)]
        card_names = {cid: f"Card {i}" for i, cid in enumerate(cat_ids)}
        
        ckpt_path = Path(tmpdir) / "tiny.pt"
        torch.save(_create_tiny_checkpoint(), ckpt_path)
        
        model = TrainedModel(
            device=torch.device("cpu"),
            weights_path=ckpt_path,
            cat_full=cat_full,
            cat_art=cat_art,
            cat_ids=cat_ids,
            card_names=card_names,
        )
        
        # Create test image
        img = Image.new("RGB", (300, 400), color="red")
        
        # Test full crop
        tensor = model.preprocess(img, art_crop=False)
        assert tensor.shape == (1, 3, 224, 224)
        
        # Test art crop
        tensor_art = model.preprocess(img, art_crop=True)
        assert tensor_art.shape == (1, 3, 224, 224)


def test_trained_model_embed():
    """Test embedding extraction."""
    with tempfile.TemporaryDirectory() as tmpdir:
        n_cards = 5
        cat_full = np.random.randn(n_cards, 384).astype(np.float16)
        cat_art = np.random.randn(n_cards, 384).astype(np.float16)
        cat_ids = [f"base1-{i}" for i in range(n_cards)]
        card_names = {cid: f"Card {i}" for i, cid in enumerate(cat_ids)}
        
        ckpt_path = Path(tmpdir) / "tiny.pt"
        torch.save(_create_tiny_checkpoint(), ckpt_path)
        
        model = TrainedModel(
            device=torch.device("cpu"),
            weights_path=ckpt_path,
            cat_full=cat_full,
            cat_art=cat_art,
            cat_ids=cat_ids,
            card_names=card_names,
        )
        
        img = Image.new("RGB", (300, 400), color="blue")
        
        # Test embedding
        emb = model.embed(img, art_crop=False)
        assert emb.shape == (1, 384)
        # Check L2 normalized
        norm = np.linalg.norm(emb)
        assert abs(norm - 1.0) < 1e-5


def test_trained_model_match():
    """Test full matching pipeline."""
    with tempfile.TemporaryDirectory() as tmpdir:
        n_cards = 10
        cat_full = np.random.randn(n_cards, 384).astype(np.float16)
        cat_art = np.random.randn(n_cards, 384).astype(np.float16)
        cat_ids = [f"base1-{i}" for i in range(n_cards)]
        card_names = {cid: f"Card {i}" for i, cid in enumerate(cat_ids)}
        
        ckpt_path = Path(tmpdir) / "tiny.pt"
        torch.save(_create_tiny_checkpoint(), ckpt_path)
        
        model = TrainedModel(
            device=torch.device("cpu"),
            weights_path=ckpt_path,
            cat_full=cat_full,
            cat_art=cat_art,
            cat_ids=cat_ids,
            card_names=card_names,
            topk=5,
        )
        
        img = Image.new("RGB", (300, 400), color="green")
        
        # Test matching
        candidates, timings = model.match(img)
        
        # Check results
        assert len(candidates) <= 5
        assert "embedFullMs" in timings
        assert "embedArtMs" in timings
        assert "searchMs" in timings
        
        # Check candidate format
        for cand in candidates:
            assert "tcgdexId" in cand
            assert "name" in cand
            assert "similarity" in cand
            assert isinstance(cand["similarity"], float)


def test_load_trained_model_missing_env():
    """Test load_trained_model returns None when env vars missing."""
    import os
    # Clear all trained model env vars
    for key in [
        "TRAINED_MODEL_WEIGHTS",
        "TRAINED_MODEL_CAT_FULL",
        "TRAINED_MODEL_CAT_ART",
        "TRAINED_MODEL_CAT_IDS",
    ]:
        os.environ.pop(key, None)
    
    result = load_trained_model(torch.device("cpu"), {})
    assert result is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
