#!/usr/bin/env python3
"""Write an untrained DualBranchPSA checkpoint for local CNN wiring smoke tests.

Estimates from this file are NOT meaningful. Replace with a real phase2_best.pth
from your own PSAGradePredictor training run before trusting Prepare grades.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM_SRC = ROOT / "upstream" / "src"
OUT_DIR = ROOT / "checkpoints"
OUT_PTH = OUT_DIR / "phase2_best.pth"
OUT_CFG = OUT_DIR / "psa_dual_branch_config.json"


def main() -> int:
  if not UPSTREAM_SRC.is_dir():
    print(
      "Missing upstream clone. Run:\n"
      "  git clone https://github.com/jshan9078/PSAGradePredictor.git "
      f"{ROOT / 'upstream'}",
      file=sys.stderr,
    )
    return 1

  sys.path.insert(0, str(UPSTREAM_SRC))
  import torch
  from model import DualBranchPSA  # type: ignore

  cfg = {
    "lambda_fusion": 0.7,
    "in_channels": 6,
    "front_depth": 18,
    "back_depth": 34,
    "dropout": 0.25,
    "use_rim_mask": True,
    "rim_mask_ratio": 0.07,
    "use_coral": True,
    "num_classes": 10,
    "smoke": True,
    "note": "Untrained smoke checkpoint — not for real grading",
  }

  model = DualBranchPSA(
    lambda_fusion=cfg["lambda_fusion"],
    in_channels=cfg["in_channels"],
    front_depth=cfg["front_depth"],
    back_depth=cfg["back_depth"],
    pretrained=False,
    dropout=cfg["dropout"],
    use_rim_mask=cfg["use_rim_mask"],
    rim_mask_ratio=cfg["rim_mask_ratio"],
    use_coral=cfg["use_coral"],
    num_classes=cfg["num_classes"],
  )
  model.eval()

  OUT_DIR.mkdir(parents=True, exist_ok=True)
  torch.save(
    {
      "epoch": -1,
      "model_state_dict": model.state_dict(),
      "val_qwk": None,
      "smoke": True,
    },
    OUT_PTH,
  )
  OUT_CFG.write_text(json.dumps(cfg, indent=2) + "\n")
  print(f"Wrote {OUT_PTH}")
  print(f"Wrote {OUT_CFG}")
  print("Replace with a trained phase2_best.pth before trusting Prepare grades.")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
