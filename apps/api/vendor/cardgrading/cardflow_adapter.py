#!/usr/bin/env python3
"""CardFlow-owned adapter: invoke vendored grade_card and print JSON.

This file is not part of https://github.com/stolemynikes/cardgrading.
It exists so the Node API can call grade_card on the same machine without
hosting the upstream FastAPI app.

Identification and market lookup are skipped: those need API keys and a
network. Every sub-grade the library measures still runs offline.

CardFlow additions (2026-10-05):
* Capture checks (cardflow_capture_checks.py) on both sides before grading:
  a blurry photo or a card too small in the frame is a retake, not a grade.
  Sharpness and effective DPI go into report["cardflow"]["capture"].
* Optional raking-light rotation shots of the front (--angled-front, 3-4
  photos, card turned a quarter-turn each time under one low lamp). They feed
  upstream's own photometric-stereo surface path, but only after
  cardflow_raking_light.py confirms the light was directional and turned
  with the card. Otherwise surface stays not graded.
"""

from __future__ import annotations

import argparse
import json
import sys
import types
from pathlib import Path

VENDOR_ROOT = Path(__file__).resolve().parent

# Rotation shots are only registered to the flat front, never measured for
# corners/edges, and upstream detects each one up to four times. Capping the
# long edge keeps a 4-shot set inside the API timeout.
ANGLED_MAX_LONG_EDGE = 3024
ORIENTATION_PROBE_LONG_EDGE = 1344.0


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


def _prepare_side(photo: Path, output_dir: Path, label: str, thresholds: dict, detect):
    """Upright copy (same orientation rule as /v1/grade/detect) plus capture
    checks on a full-resolution canonical warp.

    Orientation is decided on a small copy (~0.5 s, not a second full-size
    detect); the small quad is scaled back up to warp the full photo once, so
    sharpness and DPI are measured at full resolution. Returns
    (path_for_grade_card, checks_or_None, full_res_warp_or_None).
    """
    import cv2
    from cardflow_capture_checks import capture_checks
    from cardflow_orientation import detect_upright

    image = cv2.imread(str(photo))
    if image is None:
        return photo, None, None  # grade_card's own load_image reports the decode error
    h, w = image.shape[:2]
    scale = min(1.0, ORIENTATION_PROBE_LONG_EDGE / max(h, w))
    small = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    result, rotated = detect_upright(small, thresholds, detect)

    checks = None
    warp = None
    if result.contour is not None:
        corners = result.contour.astype("float32") / scale
        cap_cfg = thresholds["capture"]
        size = (cap_cfg["canonical_width_px"], cap_cfg["canonical_height_px"])
        warp = detect.perspective_correct(image, corners, size)
        checks = capture_checks(warp, corners)

    if not rotated:
        return photo, checks, warp
    output_dir.mkdir(parents=True, exist_ok=True)
    upright = output_dir / f"{label}_upright.png"
    cv2.imwrite(str(upright), cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE))
    return upright, checks, warp


def _angled_copy(photo: Path, output_dir: Path, index: int) -> Path:
    import cv2

    image = cv2.imread(str(photo))
    if image is None:
        return photo
    h, w = image.shape[:2]
    if max(h, w) <= ANGLED_MAX_LONG_EDGE:
        return photo
    s = ANGLED_MAX_LONG_EDGE / max(h, w)
    small = cv2.resize(image, (int(round(w * s)), int(round(h * s))), interpolation=cv2.INTER_AREA)
    output_dir.mkdir(parents=True, exist_ok=True)
    out = output_dir / f"angled_{index}.jpg"
    cv2.imwrite(str(out), small, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    return out


def _fast_normalise_scan(grade, detect, thresholds_for_upright):
    """Drop-in for upstream grade.normalise_scan with one detect per shot.

    Upstream detects every rotation scan at 0/90/180/270 (four full detects)
    and keeps the orientation whose warp best matches the flat capture.
    Here: one detect with the CardFlow portrait relabel (0 or 270 CCW), then
    the same content match decides between that and +180, using upstream's
    _orientation_match and MIN_ORIENTATION_CONFIDENCE. Same return shape.
    """
    import cv2
    import numpy as np
    from cardflow_orientation import detect_upright

    cache: dict[str, tuple] = {}

    def normalise_scan(path: Path, reference_warp, thresholds: dict):
        key = str(path)
        if key in cache:
            return cache[key]
        image = grade.load_image(path)
        result, rotated = detect_upright(image, thresholds, detect)
        if result.warped is None or result.hard_failures:
            cache[key] = (None, None, False, {})
            return cache[key]
        base = 270 if rotated else 0
        flipped = cv2.rotate(result.warped, cv2.ROTATE_180)
        a = grade._orientation_match(result.warped, reference_warp)
        b = grade._orientation_match(flipped, reference_warp)
        if a >= b:
            warp, ccw, score, runner_up = result.warped, base, a, b
        else:
            warp, ccw, score, runner_up = flipped, (base + 180) % 360, b, a
        confident = score >= grade.MIN_ORIENTATION_CONFIDENCE and score - runner_up >= 0.1
        quad = result.contour.astype(np.float64)
        diagnostics = {
            "contour": result.contour,
            "orientation_score": round(float(score), 3),
            "runner_up_score": round(float(runner_up), 3),
            "quad_width_px": round(float((np.linalg.norm(quad[1] - quad[0]) + np.linalg.norm(quad[2] - quad[3])) / 2), 1),
            "quad_height_px": round(float((np.linalg.norm(quad[3] - quad[0]) + np.linalg.norm(quad[2] - quad[1])) / 2), 1),
            "scan_size_px": [int(image.shape[1]), int(image.shape[0])],
        }
        cache[key] = (warp, ccw, confident, diagnostics)
        return cache[key]

    return normalise_scan


def _check_angled(paths: list[Path], reference_warp, thresholds: dict, normalise_scan) -> dict:
    """Pre-flight every rotation shot, then the light check. Never grades."""
    from cardflow_capture_checks import capture_checks
    from cardflow_raking_light import check_rotation_set

    shots = []
    accepted: list[Path] = []
    warps = []
    rotations: list[int] = []
    for path in paths:
        warp, ccw, confident, diag = normalise_scan(path, reference_warp, thresholds)
        shot: dict = {"name": path.name}
        if warp is None:
            shot["rejected"] = "card not found or not flat"
            shots.append(shot)
            continue
        checks = capture_checks(warp, diag.get("contour"))
        shot.update({"rotation_deg": ccw, "orientation_confident": bool(confident), **checks["metrics"]})
        hard = [g["name"] for g in checks["gates"] if g["hard"] and not g["passed"]]
        if hard:
            shot["rejected"] = ",".join(hard)
        elif not confident:
            shot["rejected"] = "rotation unclear"
        else:
            accepted.append(path)
            warps.append(warp)
            rotations.append(int(ccw))
        shots.append(shot)

    light = check_rotation_set(warps, rotations) if len(warps) >= 3 else {
        "ok": False,
        "reason": "too_few_usable",
        "lamp_azimuth_deg": None,
        "shots": [],
    }
    return {"accepted": accepted, "shots": shots, "light": light}


def _photometric_ok(report: dict) -> tuple[bool, str | None]:
    vision = ((report.get("card_vision") or {}).get("front")) or {}
    if vision.get("method") != "photometric_stereo":
        return False, f"upstream fell back: {vision.get('fallback_reason')}"
    if (vision.get("light_count") or 0) < 3:
        return False, "fewer than 3 light directions solved"
    for frame in vision.get("registration") or []:
        if isinstance(frame, dict) and frame.get("rejected_at") is not None:
            return False, "a rotation shot did not register to the front"
    return True, None


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
    parser.add_argument(
        "--angled-front",
        nargs="*",
        type=Path,
        default=[],
        help="Optional raking-light shots of the front, card turned a quarter-turn each time.",
    )
    parser.add_argument(
        "--extras-dir",
        type=Path,
        default=None,
        help="Full 14-photo extras dir: <side>-tilt_a|tilt_b|corner_*.{jpg,png,webp}.",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    sys.path.insert(0, str(VENDOR_ROOT))
    _skip_identify()

    import grade
    from grade import grade_card
    from pipeline import detect

    thresholds = detect.load_thresholds(args.thresholds)
    front_path, front_checks, front_warp = _prepare_side(args.front, args.output_dir, "front", thresholds, detect)
    back_path, back_checks, _back_warp = _prepare_side(args.back, args.output_dir, "back", thresholds, detect)

    cardflow: dict = {
        "capture": {
            "front": front_checks["metrics"] if front_checks else None,
            "back": back_checks["metrics"] if back_checks else None,
        },
        "angled": {"provided": len(args.angled_front), "used": 0, "status": "not_provided"},
    }

    # Blurry or too-far: answer with the failed gate only, no grade.
    hard_capture = {
        side: [g for g in checks["gates"] if g["hard"] and not g["passed"]]
        for side, checks in (("front", front_checks), ("back", back_checks))
        if checks
    }
    if any(hard_capture.values()):
        report = {
            "capture_quality": {side: {"gates": gates} for side, gates in hard_capture.items() if gates},
            "cardflow": cardflow,
        }
        json.dump(report, sys.stdout)
        sys.stdout.write("\n")
        return 0

    photometric_front = None
    lamp_azimuth = 90.0
    if args.angled_front:
        angled_dir = args.output_dir / "angled"
        copies = [_angled_copy(path, angled_dir, i) for i, path in enumerate(args.angled_front)]
        grade.normalise_scan = _fast_normalise_scan(grade, detect, thresholds)
        if front_warp is None:
            cardflow["angled"].update({"status": "rejected", "detail": "front not found"})
        else:
            checked = _check_angled(copies, front_warp, thresholds, grade.normalise_scan)
            light = checked["light"]
            cardflow["angled"].update(
                {
                    "shots": checked["shots"],
                    "light": {k: v for k, v in light.items() if k != "ok"},
                }
            )
            if light["ok"]:
                photometric_front = checked["accepted"]
                lamp_azimuth = float(light["lamp_azimuth_deg"])
            elif light["reason"] in ("no_directional_light", "light_did_not_turn_with_card", "not_rotated"):
                cardflow["angled"]["status"] = "no_light_change"
            else:
                cardflow["angled"]["status"] = "rejected"

    def run(photometric):
        return grade_card(
            front_path,
            back_path,
            thresholds,
            args.output_dir,
            verbose=False,
            photometric_paths=(photometric, None),
            lamp_azimuth=lamp_azimuth,
            rotation="cw",
        )

    report = run(photometric_front)
    if photometric_front:
        ok, why = _photometric_ok(report)
        if ok:
            cardflow["angled"].update({"status": "graded", "used": len(photometric_front)})
        else:
            # Upstream solved something we don't trust: grade again without
            # it so the overall estimate can't include a guessed surface.
            cardflow["angled"].update({"status": "solve_failed", "detail": why})
            report = run(None)

    # CardFlow's soft "card is small in the photo" joins upstream's soft gates.
    for side, checks in (("front", front_checks), ("back", back_checks)):
        if not checks:
            continue
        soft = [g for g in checks["gates"] if not g["hard"]]
        side_quality = (report.get("capture_quality") or {}).get(side)
        if soft and isinstance(side_quality, dict) and isinstance(side_quality.get("gates"), list):
            side_quality["gates"].extend(soft)
    report["cardflow"] = cardflow
    if args.extras_dir is not None:
        from cardflow_full_extras import analyze_extras, merge_full_extras_into_report

        extras = analyze_extras(args.extras_dir, front_path, back_path)
        report = merge_full_extras_into_report(report, extras, thresholds)
    json.dump(report, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
