"""CardFlow-owned: run corner close-up + tilt surface checks and merge into a grade report.

Not part of https://github.com/stolemynikes/cardgrading.

Extras dir layout (written by apps/api grade-extra-store):
  <side>-<shot>.<ext>  e.g. front-tilt_a.jpg, back-corner_tl.png
Optional meta.json with createdAt / sessionId.

Combine rules (documented for the PR):
  * Corners: per-corner close-up score 0–10 (advisory checkNotes always).
    Only high-confidence close-ups (RETUNE_CORNER_CLOSEUP gate) may lower
    the flat corners grade, and by at most 1 point. See
    cardflow_corner_closeup.combine_corner_scores.
  * Surface: tilt+flat difference score replaces "not assessed" when
    photometric stereo was not used. If photometric already graded, keep it
    and still attach tilt notes when they flag worse defects (min of scores).
  * Overall: reassembled with scoring.assemble_grade from the adjusted
    sub-grades. Only when at least one extra check measured something.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
from cardflow_corner_closeup import CORNER_NAMES, analyze_corner_closeup, combine_corner_scores
from cardflow_tilt_surface import analyze_tilt_surface
from pipeline import scoring

SHOT_EXTS = (".jpg", ".jpeg", ".png", ".webp")


def _find_shot(extras_dir: Path, side: str, shot: str) -> Path | None:
    for ext in SHOT_EXTS:
        path = extras_dir / f"{side}-{shot}{ext}"
        if path.is_file():
            return path
    # Also accept the stamped names from older saves: *-{side}-{shot}.ext
    matches = sorted(extras_dir.glob(f"*-{side}-{shot}.*"))
    return matches[-1] if matches else None


def _load(path: Path | None):
    if path is None:
        return None
    return cv2.imread(str(path))


def _as_int(value) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)) and value == value:
        return int(value)
    return None


def analyze_extras(extras_dir: Path, flat_front: Path | None, flat_back: Path | None) -> dict:
    """Run all available extra checks. Returns cardflow.full_extras payload."""
    out: dict = {
        "corners": {"front": {}, "back": {}},
        "surface": {"front": None, "back": None},
        "check_notes": [],
        "used": False,
    }
    notes: list[str] = []

    for side in ("front", "back"):
        side_corners = {}
        for name in CORNER_NAMES:
            path = _find_shot(extras_dir, side, f"corner_{name}")
            img = _load(path)
            if img is None:
                continue
            result = analyze_corner_closeup(img, name)
            side_corners[name] = result.to_dict()
            if result.note:
                prefix = "Front" if side == "front" else "Back"
                notes.append(f"{prefix}: {result.note}")
        if side_corners:
            scores = [
                c["score"]
                for c in side_corners.values()
                if c.get("measurable") and c.get("score") is not None
            ]
            hc_scores = [
                c["score"]
                for c in side_corners.values()
                if c.get("measurable") and c.get("high_confidence") and c.get("score") is not None
            ]
            out["corners"][side] = {
                "corners": side_corners,
                "side_score": min(scores) if scores else None,
                "high_confidence_side_score": min(hc_scores) if hc_scores else None,
                "high_confidence": bool(hc_scores),
            }

    for side, flat_path in (("front", flat_front), ("back", flat_back)):
        tilt_a = _load(_find_shot(extras_dir, side, "tilt_a"))
        tilt_b = _load(_find_shot(extras_dir, side, "tilt_b"))
        flat = _load(flat_path) if flat_path and flat_path.is_file() else None
        if flat is None or (tilt_a is None and tilt_b is None):
            continue
        # Need at least one tilt; prefer both.
        a = tilt_a if tilt_a is not None else tilt_b
        b = tilt_b if tilt_b is not None else tilt_a
        result, _mask = analyze_tilt_surface(flat, a, b)
        out["surface"][side] = result.to_dict()
        for note in result.notes:
            prefix = "Front" if side == "front" else "Back"
            notes.append(f"{prefix}: {note}")

    # Dedupe notes, cap length.
    seen = set()
    for note in notes:
        if note not in seen:
            seen.add(note)
            out["check_notes"].append(note)
        if len(out["check_notes"]) >= 8:
            break

    out["used"] = bool(out["corners"]["front"] or out["corners"]["back"] or out["surface"]["front"] or out["surface"]["back"])
    return out


def merge_full_extras_into_report(report: dict, extras: dict, thresholds: dict) -> dict:
    """Adjust corners/surface sub-grades and reassemble overall when extras measured."""
    if not extras.get("used"):
        report.setdefault("cardflow", {})["full_extras"] = extras
        return report

    ce = report.get("corners_edges") or {}
    sub = report.get("subgrades") or {}
    surface = report.get("surface") or {}
    ge = report.get("grade_estimate") or {}

    # --- Corners: advisory close-ups; lower flat by ≤1 only if high-confidence ---
    for side in ("front", "back"):
        close = (extras.get("corners") or {}).get(side) or {}
        close_score = _as_int(close.get("high_confidence_side_score"))
        # Fall back: legacy side_score only counts when high_confidence flag set.
        high_confidence = bool(close.get("high_confidence"))
        if close_score is None and high_confidence:
            close_score = _as_int(close.get("side_score"))
        flat_side = (ce.get(side) or {})
        flat_corners = _as_int(flat_side.get("corners_grade"))
        combined = combine_corner_scores(
            flat_corners, close_score, high_confidence=high_confidence and close_score is not None
        )
        if combined is None:
            continue
        if side not in ce or not isinstance(ce[side], dict):
            ce[side] = {}
        ce[side]["corners_grade"] = combined
        ce[side]["closeup_corners_grade"] = _as_int(close.get("side_score"))
        ce[side]["closeup_high_confidence"] = high_confidence
        # Keep edges from flat; recompute side grade as min(corners, edges).
        edges = _as_int(ce[side].get("edges_grade"))
        parts = [g for g in (combined, edges) if g is not None]
        if parts:
            ce[side]["grade"] = min(parts)
        if side in sub and isinstance(sub[side], dict):
            sub[side]["corners"] = combined

    sides_ce = [g for g in (_as_int((ce.get("front") or {}).get("grade")), _as_int((ce.get("back") or {}).get("grade"))) if g is not None]
    if sides_ce:
        ce["overall_grade"] = min(sides_ce)
    report["corners_edges"] = ce

    # --- Surface: use tilt score when photometric didn't grade ---
    angled_status = ((report.get("cardflow") or {}).get("angled") or {}).get("status")
    photometric = angled_status == "graded"
    for side in ("front", "back"):
        tilt = (extras.get("surface") or {}).get(side) or {}
        tilt_score = _as_int(tilt.get("score")) if tilt.get("measurable") else None
        if tilt_score is None:
            continue
        if side not in surface or not isinstance(surface[side], dict):
            surface[side] = {}
        existing = _as_int(surface[side].get("grade"))
        if photometric and existing is not None:
            surface[side]["grade"] = min(existing, tilt_score)
            surface[side]["tilt_surface_grade"] = tilt_score
        else:
            surface[side]["grade"] = tilt_score
            surface[side]["tilt_surface_grade"] = tilt_score
            surface[side]["method"] = "tilt_difference"
        if side in sub and isinstance(sub[side], dict):
            sub[side]["surface"] = surface[side]["grade"]
    report["surface"] = surface
    report["subgrades"] = sub

    # Mark angled/full path so the TS mapper trusts surface.
    cardflow = report.setdefault("cardflow", {})
    cardflow["full_extras"] = extras
    if not photometric and any((extras.get("surface") or {}).get(s) for s in ("front", "back")):
        cardflow.setdefault("angled", {})
        # Keep angled status honest; surface trust comes from full_extras.
        cardflow["full_extras"]["surface_trusted"] = True

    centering_grade = _as_int((report.get("centering") or {}).get("overall_grade"))
    corners_edges_grade = _as_int(ce.get("overall_grade"))
    # Prefer min of per-side surface grades we now have.
    surf_grades = []
    for side in ("front", "back"):
        g = _as_int((surface.get(side) or {}).get("grade"))
        if g is not None:
            surf_grades.append(g)
    surface_grade = min(surf_grades) if surf_grades else _as_int(ge.get("surface_grade"))

    dims = report.get("dimensions") or {}
    within = dims.get("within_tolerance") if isinstance(dims, dict) else None
    estimate = scoring.assemble_grade(
        centering_grade,
        corners_edges_grade,
        surface_grade,
        thresholds,
        dimensions_within_tolerance=within if isinstance(within, bool) else None,
    )
    report["grade_estimate"] = estimate.to_dict()
    return report


def run_from_cli(extras_dir: str, flat_front: str | None, flat_back: str | None, report_path: str | None, thresholds_path: str) -> dict:
    from pipeline import detect

    extras = analyze_extras(
        Path(extras_dir),
        Path(flat_front) if flat_front else None,
        Path(flat_back) if flat_back else None,
    )
    if report_path:
        report = json.loads(Path(report_path).read_text())
        thresholds = detect.load_thresholds(Path(thresholds_path))
        return merge_full_extras_into_report(report, extras, thresholds)
    return {"cardflow": {"full_extras": extras}}
