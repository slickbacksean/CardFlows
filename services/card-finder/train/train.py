"""Train the card-finder mask model (U-Net, MobileNetV3-Large encoder) on synthetic composites.

    python3 train.py --art 'ART/*.jpg' --tex 'TEX/*.jpg' --steps 4000 --out ../models

Weights: trained FROM SCRATCH (random init) on our synthetic data only. No ImageNet or
other pretrained weights are used, so no dataset terms ride along. Code licenses:
segmentation_models_pytorch (MIT), timm MobileNetV3 architecture (Apache-2.0), PyTorch (BSD). Exports models/card-finder.onnx (opset 17) for ONNX Runtime (MIT).
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import segmentation_models_pytorch as smp
import torch
from torch.utils.data import DataLoader, IterableDataset, get_worker_info

from synth import Synth

HERE = Path(__file__).resolve().parent


def art_ids(split: str) -> set[str]:
    rows = (HERE / "art-list.tsv").read_text().splitlines()[1:]
    return {r.split("\t")[0] for r in rows if r.split("\t")[2] == split}

MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)
SIZE = 256


def build_model() -> torch.nn.Module:
    return smp.Unet("timm-mobilenetv3_large_100", encoder_weights=None, classes=1, decoder_channels=(128, 64, 32, 16, 8))


class SynthStream(IterableDataset):
    def __init__(self, art: str, tex: str, seed: int, art_ids: set[str], real: list[Path] | None = None, real_frac: float = 0.0):
        self.art, self.tex, self.seed, self.art_ids = art, tex, seed, art_ids
        self.real, self.real_frac = real or [], real_frac

    def __iter__(self):
        import cv2

        cv2.setNumThreads(1)
        torch.set_num_threads(1)
        info = get_worker_info()
        wid = info.id if info else 0
        synth = Synth(self.art, self.tex, SIZE, seed=self.seed * 1000 + wid, art_ids=self.art_ids)
        np.random.seed(self.seed * 1000 + wid)
        from real import RealSampler

        real = RealSampler(self.real, "train", SIZE, seed=self.seed * 1000 + wid) if self.real else None
        pick = np.random.default_rng(self.seed * 7 + wid)
        while True:
            if real is not None and len(real) and pick.random() < self.real_frac:
                img, mask, _ = real.sample()
            else:
                img, mask = synth.sample()
            x = ((img[..., ::-1].astype(np.float32) / 255 - MEAN) / STD).transpose(2, 0, 1)
            yield torch.from_numpy(x.copy()), torch.from_numpy(mask[None].astype(np.float32))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--art", required=True)
    ap.add_argument("--tex", required=True)
    ap.add_argument("--steps", type=int, default=4000)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "models")
    ap.add_argument("--resume", type=Path)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--real", type=Path, nargs="*", default=[], help="real-photo manifests (train split used)")
    ap.add_argument("--real-frac", type=float, default=0.4)
    args = ap.parse_args()
    torch.manual_seed(0)
    torch.set_num_threads(5)
    model = build_model()
    if args.resume:
        model.load_state_dict(torch.load(args.resume, map_location="cpu"))
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.steps, pct_start=0.05)
    dice = smp.losses.DiceLoss("binary")
    bce = torch.nn.BCEWithLogitsLoss()
    ids = art_ids("train")
    config = {"model": "Unet/timm-mobilenetv3_large_100", "encoder_weights": None, "size": SIZE, "steps": args.steps,
              "batch": args.batch, "lr": args.lr, "loss": "bce+dice", "art_train_ids": len(ids), "seed": args.seed,
              "resumed_from": str(args.resume) if args.resume else None,
              "real_manifests": [p.name for p in args.real], "real_frac": args.real_frac if args.real else 0.0}
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "card-finder.config.json").write_text(json.dumps(config, indent=2) + "\n")
    loader = DataLoader(SynthStream(args.art, args.tex, args.seed, ids, args.real, args.real_frac), batch_size=args.batch, num_workers=3)
    args.out.mkdir(parents=True, exist_ok=True)
    model.train()
    t0 = time.time()
    for step, (x, y) in enumerate(loader, 1):
        logits = model(x)
        loss = bce(logits, y) + dice(logits, y)
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        if step % 50 == 0:
            print(f"step {step} loss {loss.item():.4f} {time.time() - t0:.0f}s", flush=True)
        if step % 500 == 0 or step == args.steps:
            torch.save(model.state_dict(), args.out / "card-finder.pt")
        if step >= args.steps:
            break
    model.eval()
    torch.onnx.export(model, torch.zeros(1, 3, SIZE, SIZE), str(args.out / "card-finder.onnx"),
                      input_names=["image"], output_names=["mask_logits"], opset_version=17, dynamo=False)
    print("exported", args.out / "card-finder.onnx")


if __name__ == "__main__":
    main()
