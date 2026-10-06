#!/usr/bin/env python3
"""CardFlow-owned adapter: invoke vendored grade_card and print JSON.

This file is not part of https://github.com/stolemynikes/cardgrading.
It exists so the Node API can call grade_card on the same machine without
hosting the upstream FastAPI app.

Identification and market lookup are skipped: those need API keys and a
network. Every sub-grade the library measures still runs offline.
"""

from __future__ import annotations

import argparse
import json
import sys
import types
from pathlib import Path

VENDOR_ROOT = Path(__file__).resolve().parent


def _skip_identify() -> None:
    """Install a stub before importing grade so anthropic/Gemini never load."""
    vision = types.ModuleType("llm.vision")

    class VisionUnavailable(Exception):
        """Same contract as the vendored llm.vision.VisionUnavailable."""

    def identify_card(*_args, **_kwargs):
        raise VisionUnavailable("CardFlow adapter skips card identification")

    vision.VisionUnavailable = VisionUnavailable
    vision.identify_card = identify_card
    sys.modules["llm.vision"] = vision


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run vendored grade_card for CardFlow.")
    parser.add_argument("--front", type=Path, required=True)
    parser.add_argument("--back", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--thresholds",
        type=Path,
        default=VENDOR_ROOT / "calibration" / "thresholds.json",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    sys.path.insert(0, str(VENDOR_ROOT))
    _skip_identify()

    from grade import grade_card
    from pipeline import detect

    thresholds = detect.load_thresholds(args.thresholds)
    report = grade_card(
        args.front,
        args.back,
        thresholds,
        args.output_dir,
        verbose=False,
    )
    json.dump(report, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
