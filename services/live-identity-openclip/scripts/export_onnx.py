"""
Export trained DINOv2-S model to ONNX format for faster CPU inference.

Usage:
  python scripts/export_onnx.py --weights b1_best.pt --output b1_dinov2.onnx
  python scripts/export_onnx.py --weights b1_best.pt --output b1_dinov2.onnx --check

The --check flag runs a parity test comparing PyTorch vs ONNX outputs.
"""

import argparse
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import timm
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image


class ResidualHead(nn.Module):
    """Residual linear head: output = x + A(x), then L2 normalize."""

    def __init__(self, dim: int = 384):
        super().__init__()
        self.A = nn.Linear(dim, dim, bias=False)
        nn.init.zeros_(self.A.weight)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.A(x)
        return F.normalize(x, dim=-1)


class FullModel(nn.Module):
    """Combined DINOv2-S + residual head for ONNX export."""

    def __init__(self, backbone: nn.Module, head: nn.Module):
        super().__init__()
        self.backbone = backbone
        self.head = head

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        features = self.backbone(x)
        return self.head(features)


def load_pytorch_model(weights_path: Path, device: torch.device) -> nn.Module:
    """Load trained PyTorch model."""
    print(f"Loading PyTorch model from {weights_path}...")
    
    # Load backbone
    model = timm.create_model(
        "vit_small_patch14_dinov2.lvd142m",
        pretrained=True,
        num_classes=0,
        img_size=224,
    ).to(device)
    model.eval()
    
    # Load checkpoint
    checkpoint = torch.load(weights_path, map_location="cpu", weights_only=True)
    
    # Load trained blocks
    if "blocks" in checkpoint:
        model.load_state_dict(checkpoint["blocks"], strict=False)
    
    # Load head
    head = ResidualHead(dim=384).to(device)
    if "head" in checkpoint:
        head.load_state_dict(checkpoint["head"])
    head.eval()
    
    # Combine
    full_model = FullModel(model, head)
    full_model.eval()
    
    return full_model


def export_to_onnx(
    model: nn.Module,
    output_path: Path,
    device: torch.device,
    opset_version: int = 17,
) -> None:
    """Export PyTorch model to ONNX."""
    print(f"Exporting to ONNX: {output_path}...")
    
    # Create dummy input (1, 3, 224, 224)
    dummy_input = torch.randn(1, 3, 224, 224, device=device)
    
    # Export
    torch.onnx.export(
        model,
        dummy_input,
        str(output_path),
        export_params=True,
        opset_version=opset_version,
        do_constant_folding=True,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={
            "input": {0: "batch_size"},
            "output": {0: "batch_size"},
        },
    )
    
    print(f"Exported to {output_path} ({output_path.stat().st_size / 1024 / 1024:.1f} MB)")
    
    # Verify ONNX model
    onnx_model = onnx.load(str(output_path))
    onnx.checker.check_model(onnx_model)
    print("ONNX model check passed")


def check_parity(
    pytorch_model: nn.Module,
    onnx_path: Path,
    device: torch.device,
    n_samples: int = 10,
    rtol: float = 1e-3,
    atol: float = 1e-5,
) -> None:
    """Check parity between PyTorch and ONNX outputs."""
    print(f"\nChecking parity between PyTorch and ONNX ({n_samples} samples)...")
    
    # Load ONNX model
    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    providers = ["CPUExecutionProvider"]
    ort_session = ort.InferenceSession(str(onnx_path), sess_options, providers=providers)
    
    pytorch_model.eval()
    max_diff = 0.0
    
    for i in range(n_samples):
        # Random input
        x = torch.randn(1, 3, 224, 224, device=device)
        
        # PyTorch inference
        with torch.no_grad():
            pt_output = pytorch_model(x).cpu().numpy()
        
        # ONNX inference
        onnx_input = x.cpu().numpy()
        ort_output = ort_session.run(["output"], {"input": onnx_input})[0]
        
        # Compare
        diff = np.abs(pt_output - ort_output).max()
        max_diff = max(max_diff, diff)
        
        if not np.allclose(pt_output, ort_output, rtol=rtol, atol=atol):
            print(f"  Sample {i+1}: FAILED (max diff: {diff:.6f})")
        else:
            print(f"  Sample {i+1}: OK (max diff: {diff:.6f})")
    
    print(f"\nParity check complete. Max difference: {max_diff:.6f}")
    if max_diff < atol:
        print("✓ PASS: Outputs match within tolerance")
    else:
        print(f"⚠ WARN: Max diff {max_diff:.6f} exceeds atol {atol:.6f}")


def benchmark_onnx(
    onnx_path: Path,
    n_warmup: int = 10,
    n_samples: int = 100,
) -> None:
    """Benchmark ONNX inference speed."""
    print(f"\nBenchmarking ONNX inference ({n_samples} samples)...")
    
    import time
    
    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    providers = ["CPUExecutionProvider"]
    ort_session = ort.InferenceSession(str(onnx_path), sess_options, providers=providers)
    
    dummy_input = np.random.randn(1, 3, 224, 224).astype(np.float32)
    
    # Warmup
    for _ in range(n_warmup):
        ort_session.run(["output"], {"input": dummy_input})
    
    # Benchmark
    times = []
    for _ in range(n_samples):
        start = time.perf_counter()
        ort_session.run(["output"], {"input": dummy_input})
        times.append((time.perf_counter() - start) * 1000)
    
    times = sorted(times)
    p50 = times[len(times) // 2]
    p95 = times[int(len(times) * 0.95)]
    mean = sum(times) / len(times)
    
    print(f"  Mean: {mean:.2f} ms")
    print(f"  P50:  {p50:.2f} ms")
    print(f"  P95:  {p95:.2f} ms")


def main():
    parser = argparse.ArgumentParser(description="Export trained model to ONNX")
    parser.add_argument("--weights", type=Path, required=True, help="Path to b1_best.pt")
    parser.add_argument("--output", type=Path, required=True, help="Output ONNX path")
    parser.add_argument("--check", action="store_true", help="Run parity check")
    parser.add_argument("--benchmark", action="store_true", help="Benchmark ONNX speed")
    parser.add_argument("--device", default="cpu", help="Device (cpu/cuda/mps)")
    parser.add_argument("--opset", type=int, default=17, help="ONNX opset version")
    
    args = parser.parse_args()
    
    if not args.weights.is_file():
        print(f"Error: weights file not found: {args.weights}")
        return 1
    
    device = torch.device(args.device)
    
    # Load PyTorch model
    pytorch_model = load_pytorch_model(args.weights, device)
    
    # Export to ONNX
    args.output.parent.mkdir(parents=True, exist_ok=True)
    export_to_onnx(pytorch_model, args.output, device, opset_version=args.opset)
    
    # Parity check
    if args.check:
        check_parity(pytorch_model, args.output, device)
    
    # Benchmark
    if args.benchmark:
        benchmark_onnx(args.output)
    
    print(f"\n✓ Done! ONNX model saved to {args.output}")
    print(f"\nTo use in production, set:")
    print(f"  TRAINED_MODEL_WEIGHTS={args.output}")
    print(f"  # (and keep CAT_FULL/CAT_ART/CAT_IDS env vars)")
    
    return 0


if __name__ == "__main__":
    exit(main())
