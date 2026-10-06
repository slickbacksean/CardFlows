import {
  emptyGradeSubgrades,
  GRADE_ESTIMATE_DISCLAIMER,
  GRADE_ESTIMATE_LABEL,
  PHOTO_PREGRADE_SOURCE,
  PREGRADE_DISCLAIMER,
  PREGRADE_LABEL,
  PREGRADE_SURFACE_NULL_REASON,
  type CardFlowGradeEstimate,
  type DetectCropResult,
  type DetectCropRetake,
  type DetectedCardCrop,
  type GradeSubgrade,
  type PhotoPregradeRetake,
  type PhotoPregradeSide,
  type PhotoPregradeSubgrade,
  type PhotoPregradeSuccess,
} from "@cardflow/shared";

/**
 * Port of GitHub main packages/api/src/grading/photo-pregrade-mapper.ts and
 * map-detect-result.ts. The only overall number is
 * `grade_estimate.overall_grade`. Hard capture gates (card not found, tilt,
 * aspect) are a retake with no number. Soft gates (glare, lighting,
 * resolution) still score, with a warning.
 */

const HARD_GATE_NAMES = new Set(["card_detection", "tilt", "aspect_ratio"]);

const HARD_GATE_TIPS: Record<string, string> = {
  card_detection: "Card not found",
  tilt: "Camera angle too tilted",
  aspect_ratio: "Unexpected aspect ratio",
};

const SOFT_GATE_LABELS: Record<string, string> = {
  resolution: "Resolution too low",
  glare: "Glare detected",
  uneven_lighting: "Uneven lighting",
};

const SURFACE_EXCLUDED_NOTE = "overall estimate excludes surface";
const DIMENSIONS_NOTE = "dimensions not measured without dpi";

interface LibraryGate {
  name?: unknown;
  passed?: unknown;
  detail?: unknown;
  hard?: unknown;
}

type PillarKey = "centering" | "corners" | "edges" | "surface";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asGates(value: unknown): LibraryGate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((gate): gate is LibraryGate => isRecord(gate));
}

function isHardGate(gate: LibraryGate): boolean {
  if (typeof gate.name !== "string") return false;
  if (typeof gate.hard === "boolean") return gate.hard;
  return HARD_GATE_NAMES.has(gate.name);
}

function hardGateReason(gate: LibraryGate): string {
  if (typeof gate.name === "string") {
    const tip = HARD_GATE_TIPS[gate.name];
    if (tip) return tip;
  }
  if (typeof gate.detail === "string" && gate.detail.trim() !== "") return gate.detail;
  return "Card not found";
}

function softGateLabel(gate: LibraryGate): string {
  const name = gate.name as string;
  return SOFT_GATE_LABELS[name] ?? name;
}

function failedSoftGates(gates: LibraryGate[]): LibraryGate[] {
  return gates.filter(
    (gate) => gate.passed === false && !isHardGate(gate) && typeof gate.name === "string",
  );
}

/* ----------------------------- detect / crop ----------------------------- */

function toCrop(cropBytes: Buffer | null): DetectedCardCrop | undefined {
  if (!cropBytes || cropBytes.byteLength === 0) return undefined;
  return { mimeType: "image/jpeg", base64: cropBytes.toString("base64") };
}

export function mapDetectReport(
  input: unknown,
  side: PhotoPregradeSide,
  cropBytes: Buffer | null,
): DetectCropResult {
  const report = asRecord(input) ?? {};
  const gates = asGates(report.gates);
  const hardFailures = gates.filter((gate) => gate.passed === false && isHardGate(gate));
  const crop = toCrop(cropBytes);

  if (hardFailures.length > 0) {
    const body: DetectCropRetake = {
      ok: false,
      status: "retake",
      code: "PHOTO_RETAKE",
      side,
      reasons: hardFailures.map(hardGateReason),
    };
    if (crop) body.crop = crop;
    return body;
  }
  if (!crop) {
    return { ok: false, status: "retake", code: "PHOTO_RETAKE", side, reasons: ["Card not found"] };
  }
  return {
    ok: true,
    status: "found",
    side,
    crop,
    warnings: failedSoftGates(gates).map(softGateLabel),
  };
}

/* ------------------------------- pre-grade -------------------------------- */

function sideGrade(
  subgrades: Record<string, unknown> | null,
  side: PhotoPregradeSide,
  key: PillarKey,
  fallback: unknown,
): number | null {
  const fromSub = asFiniteNumber(asRecord(subgrades?.[side])?.[key]);
  if (fromSub !== null) return fromSub;
  return asFiniteNumber(fallback);
}

function meanPoints(front: number | null, back: number | null): number | null {
  const values = [front, back].filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return (values.reduce((sum, value) => sum + value, 0) / values.length) * 10;
}

function combinedPoints(
  combined: number | null,
  front: number | null,
  back: number | null,
): number | null {
  if (combined !== null) return combined * 10;
  return meanPoints(front, back);
}

function sideGates(report: Record<string, unknown>, side: PhotoPregradeSide): LibraryGate[] {
  return asGates(asRecord(asRecord(report.capture_quality)?.[side])?.gates);
}

function softGateWarning(report: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  for (const side of ["front", "back"] as const) {
    const failed = failedSoftGates(sideGates(report, side));
    if (failed.length === 0) continue;
    parts.push(`${side === "front" ? "Front" : "Back"}: ${failed.map(softGateLabel).join(", ")}`);
  }
  const pair = asRecord(report.capture_pair);
  if (pair?.same_side_suspected === true) {
    const note = typeof pair.note === "string" && pair.note.trim() !== "" ? pair.note : null;
    parts.push(note ?? "The front and back uploads look like the same side.");
  }
  return parts.length === 0 ? undefined : parts.join(" ");
}

function retake(side: PhotoPregradeSide, reasons: string[]): PhotoPregradeRetake {
  return {
    ok: false,
    status: "retake",
    code: "PHOTO_RETAKE",
    side,
    reasons: reasons.length > 0 ? reasons : ["Card not found"],
  };
}

function hardRetake(report: Record<string, unknown>): PhotoPregradeRetake | null {
  for (const side of ["front", "back"] as const) {
    const failed = sideGates(report, side).filter(
      (gate) => gate.passed === false && isHardGate(gate),
    );
    if (failed.length > 0) return retake(side, failed.map(hardGateReason));
  }
  return null;
}

/**
 * Map a vendored `grade_card` report to the CardFlow photo pre-grade body.
 * - `grade_estimate.overall_grade` → `estimate` (the only 1.0–10.0 number)
 * - `centering.overall_grade` → `subgrades.centering.points` (×10)
 * - `subgrades.{front,back}.*` → per-side grades
 * - corners/edges `points` = mean of per-side grades ×10
 * - `overall_grade_rounded`, `score`, and `by_grader` are dropped
 */
export function mapGradeCardReport(input: unknown): PhotoPregradeSuccess | PhotoPregradeRetake {
  const report = asRecord(input) ?? {};

  const hard = hardRetake(report);
  if (hard) return hard;

  if (report.grade_estimate == null && report.centering == null) {
    return retake("front", ["Card not found"]);
  }
  const estimate = asFiniteNumber(asRecord(report.grade_estimate)?.overall_grade);
  if (estimate === null) return retake("front", ["Card not found"]);

  const centering = asRecord(report.centering);
  const cornersEdges = asRecord(report.corners_edges);
  const surface = asRecord(report.surface);
  const subgrades = asRecord(report.subgrades);
  const dimensions = asRecord(report.dimensions);

  const cf = sideGrade(subgrades, "front", "centering", asRecord(centering?.front)?.grade);
  const cb = sideGrade(subgrades, "back", "centering", asRecord(centering?.back)?.grade);
  const kf = sideGrade(subgrades, "front", "corners", asRecord(cornersEdges?.front)?.corners_grade);
  const kb = sideGrade(subgrades, "back", "corners", asRecord(cornersEdges?.back)?.corners_grade);
  const ef = sideGrade(subgrades, "front", "edges", asRecord(cornersEdges?.front)?.edges_grade);
  const eb = sideGrade(subgrades, "back", "edges", asRecord(cornersEdges?.back)?.edges_grade);
  const sf = sideGrade(subgrades, "front", "surface", asRecord(surface?.front)?.grade);
  const sb = sideGrade(subgrades, "back", "surface", asRecord(surface?.back)?.grade);

  const surfaceNull = sf === null && sb === null;
  const noteParts: string[] = [];
  if (surfaceNull) noteParts.push(SURFACE_EXCLUDED_NOTE);
  if (dimensions?.measurable === false) noteParts.push(DIMENSIONS_NOTE);

  const surfaceRow: PhotoPregradeSubgrade = {
    points: surfaceNull ? null : meanPoints(sf, sb),
    front: sf,
    back: sb,
    ...(surfaceNull ? { reason: PREGRADE_SURFACE_NULL_REASON } : {}),
  };

  const body: PhotoPregradeSuccess = {
    ok: true,
    status: "scored",
    label: PREGRADE_LABEL,
    disclaimer: PREGRADE_DISCLAIMER,
    source: PHOTO_PREGRADE_SOURCE,
    estimate,
    subgrades: {
      centering: {
        points: combinedPoints(asFiniteNumber(centering?.overall_grade), cf, cb),
        front: cf,
        back: cb,
      },
      corners: { points: meanPoints(kf, kb), front: kf, back: kb },
      edges: { points: meanPoints(ef, eb), front: ef, back: eb },
      surface: surfaceRow,
    },
    note: noteParts.join("; "),
  };
  const warning = softGateWarning(report);
  if (warning) body.warning = warning;
  return body;
}

/**
 * Prepare-sheet DTO from a scored pre-grade. `overall` is
 * `grade_estimate.overall_grade` unchanged; subgrades are the library's
 * per-side grades (null stays null). Never recomputed by CardFlow math.
 */
export function gradeEstimateFromPregrade(result: PhotoPregradeSuccess): CardFlowGradeEstimate {
  const pillars = result.subgrades;
  const subgrades: GradeSubgrade[] = emptyGradeSubgrades().map((slot) => ({
    ...slot,
    score: pillars[slot.id][slot.side],
  }));
  const trace = [`overall=${result.estimate} from cardgrading grade_estimate.overall_grade`];
  if (pillars.surface.reason) trace.push(`surface not graded: ${pillars.surface.reason}`);
  if (result.note) trace.push(result.note);
  if (result.warning) trace.push(`warning: ${result.warning}`);
  return {
    overall: result.estimate,
    display: `AI pre-grade ${result.estimate}`,
    confidence: null,
    subgrades,
    usedBack: true,
    label: GRADE_ESTIMATE_LABEL,
    notACert: true,
    disclaimer: GRADE_ESTIMATE_DISCLAIMER,
    mathTrace: trace,
  };
}
