import {
  emptyGradeSubgrades,
  GRADE_ESTIMATE_DISCLAIMER,
  GRADE_ESTIMATE_LABEL,
  PHOTO_PREGRADE_SOURCE,
  PREGRADE_COPY,
  PREGRADE_DISCLAIMER,
  PREGRADE_LABEL,
  PREGRADE_SURFACE_NULL_REASON,
  isScoredEstimate,
  type CardFlowGradeEstimate,
  type PhotoCaptureMetrics,
  type PhotoPregradeAngled,
  type PhotoPregradeAngledStatus,
  type DetectCropResult,
  type DetectCropRetake,
  type DetectCropSuccess,
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
 * aspect, and CardFlow's sharpness / capture-scale gates from
 * cardflow_capture_checks.py) are a retake with no number. Soft gates
 * (glare, lighting, resolution, small in frame) still score, with a warning.
 *
 * Every string a user can see comes from PREGRADE_COPY (plain words, no
 * library jargon). Library details stay in mathTrace and the debug log.
 */

const HARD_GATE_NAMES = new Set(["card_detection", "tilt", "aspect_ratio", "sharpness", "capture_scale"]);

const HARD_GATE_TIPS: Record<string, string> = {
  card_detection: PREGRADE_COPY.notFound,
  tilt: PREGRADE_COPY.tilted,
  aspect_ratio: PREGRADE_COPY.shapeOff,
  sharpness: PREGRADE_COPY.blurry,
  capture_scale: PREGRADE_COPY.tooFar,
};

const SOFT_GATE_LABELS: Record<string, string> = {
  resolution: PREGRADE_COPY.lowResolution,
  glare: PREGRADE_COPY.glare,
  uneven_lighting: PREGRADE_COPY.unevenLight,
  capture_scale_low: PREGRADE_COPY.smallInFrame,
};

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

/** Adapter's own decode failure: not a detection result, so don't call it "not found". */
const DECODE_FAILURE_DETAIL = "couldn't decode image";
const DECODE_FAILURE_REASON = PREGRADE_COPY.unreadable;

/** grade_card scores 0.0 when no sub-grade could be measured; that is not a grade. */
export const NOTHING_MEASURED_REASON = PREGRADE_COPY.nothingMeasured;

/** Pre-grade numbers are 1.0–10.0. 0 is a retake, never a score. */
export { isScoredEstimate };


function hardGateReason(gate: LibraryGate): string {
  if (gate.detail === DECODE_FAILURE_DETAIL) return DECODE_FAILURE_REASON;
  if (typeof gate.name === "string") {
    const tip = HARD_GATE_TIPS[gate.name];
    if (tip) return tip;
  }
  // Never echo library detail strings ("max corner angle deviation=…") to a user.
  return PREGRADE_COPY.unusable;
}

function softGateLabel(gate: LibraryGate): string | null {
  return SOFT_GATE_LABELS[gate.name as string] ?? null;
}

function softGateLabels(gates: LibraryGate[]): string[] {
  return failedSoftGates(gates)
    .map(softGateLabel)
    .filter((label): label is string => label !== null);
}

/** cardflow_capture_checks.py metrics → the public diagnostics shape. */
function captureMetrics(value: unknown): PhotoCaptureMetrics | undefined {
  const metrics = asRecord(value);
  if (!metrics) return undefined;
  return {
    sharpness: asFiniteNumber(metrics.sharpness),
    effectiveDpi: asFiniteNumber(metrics.effective_dpi),
  };
}

function uniqueReasons(reasons: string[]): string[] {
  return [...new Set(reasons)];
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

/**
 * Blur breaks edge finding, so a blurry photo often also fails a geometry gate
 * ("tilt"). Say "blurry" first then. When the photo is sharp but the card
 * still wasn't found or its outline was wrong, the usual cause is a card that
 * blends into a light table, so add the darker-background tip.
 */
function detectRetakeReasons(hardFailures: LibraryGate[]): string[] {
  const blurry = hardFailures.some((gate) => gate.name === "sharpness");
  const ordered = blurry
    ? [...hardFailures].sort((a, b) => Number(b.name === "sharpness") - Number(a.name === "sharpness"))
    : hardFailures;
  const reasons = ordered.map(hardGateReason);
  const outlineMissed = hardFailures.some(
    (gate) =>
      (gate.name === "card_detection" || gate.name === "aspect_ratio") && gate.detail !== DECODE_FAILURE_DETAIL,
  );
  if (!blurry && outlineMissed) reasons.push(PREGRADE_COPY.darkerBackground);
  return uniqueReasons(reasons);
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
  const capture = captureMetrics(asRecord(report.cardflow_capture));

  if (hardFailures.length > 0) {
    const body: DetectCropRetake = {
      ok: false,
      status: "retake",
      code: "PHOTO_RETAKE",
      side,
      reasons: detectRetakeReasons(hardFailures),
    };
    if (crop) body.crop = crop;
    if (capture) body.capture = capture;
    return body;
  }
  if (!crop) {
    return { ok: false, status: "retake", code: "PHOTO_RETAKE", side, reasons: [PREGRADE_COPY.notFound] };
  }
  const found: DetectCropSuccess = {
    ok: true,
    status: "found",
    side,
    crop,
    warnings: softGateLabels(gates),
  };
  if (capture) found.capture = capture;
  return found;
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
    const labels = softGateLabels(sideGates(report, side));
    if (labels.length === 0) continue;
    parts.push(`${side === "front" ? "Front" : "Back"}: ${labels.join(", ")}.`);
  }
  const pair = asRecord(report.capture_pair);
  if (pair?.same_side_suspected === true) parts.push(PREGRADE_COPY.sameSide);
  return parts.length === 0 ? undefined : parts.join(" ");
}

function retake(side: PhotoPregradeSide, reasons: string[]): PhotoPregradeRetake {
  return {
    ok: false,
    status: "retake",
    code: "PHOTO_RETAKE",
    side,
    reasons: reasons.length > 0 ? uniqueReasons(reasons) : [PREGRADE_COPY.notFound],
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
    return retake("front", [PREGRADE_COPY.notFound]);
  }
  const estimate = asFiniteNumber(asRecord(report.grade_estimate)?.overall_grade);
  if (estimate === null) return retake("front", [PREGRADE_COPY.notFound]);
  // 0.0 / negative is the library's "nothing measurable" sentinel, not a grade.

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
  const angled = angledResult(report);
  const fullExtras = asRecord(asRecord(report.cardflow)?.full_extras);
  const surfaceTrusted =
    angled.status === "graded" || fullExtras?.surface_trusted === true;
  const sf = surfaceTrusted ? sideGrade(subgrades, "front", "surface", asRecord(surface?.front)?.grade) : null;
  const sb = surfaceTrusted ? sideGrade(subgrades, "back", "surface", asRecord(surface?.back)?.grade) : null;

  // scoring.py returns overall_grade 0.0 ("nothing measurable in this
  // capture") when every sub-grade is null. Never surface that as a number.
  // P0-04: any result of 0, or nothing measured, is a retake — never a score.
  const nothingMeasured = [cf, cb, kf, kb, ef, eb, sf, sb].every((value) => value === null);
  if (!isScoredEstimate(estimate) || nothingMeasured) {
    return retake("front", [NOTHING_MEASURED_REASON]);
  }

  const surfaceNull = sf === null && sb === null;
  const noteParts: string[] = [];
  if (surfaceNull) noteParts.push(PREGRADE_COPY.surfaceExcludedNote);
  else if (fullExtras?.surface_trusted === true && angled.status !== "graded") {
    noteParts.push(PREGRADE_COPY.surfaceTiltIncludedNote);
  } else {
    noteParts.push(PREGRADE_COPY.surfaceIncludedNote);
  }
  if (dimensions?.measurable === false) noteParts.push(PREGRADE_COPY.sizeNotCheckedNote);

  const surfaceRow: PhotoPregradeSubgrade = {
    points: surfaceNull ? null : meanPoints(sf, sb),
    front: sf,
    back: sb,
  };
  if (surfaceNull) surfaceRow.reason = surfaceNullReason(angled.status);
  else if (sb === null) surfaceRow.reason = PREGRADE_COPY.surfaceNotAssessedBack;

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
    note: noteParts.join(" "),
    angled,
  };
  const checkNotes = Array.isArray(fullExtras?.check_notes)
    ? (fullExtras!.check_notes as unknown[])
        .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
        .slice(0, 8)
    : [];
  if (checkNotes.length > 0) body.checkNotes = checkNotes;
  const capture = asRecord(asRecord(report.cardflow)?.capture);
  const front = captureMetrics(capture?.front);
  const back = captureMetrics(capture?.back);
  if (front || back) body.capture = { ...(front ? { front } : {}), ...(back ? { back } : {}) };
  const warning = softGateWarning(report);
  if (warning) body.warning = warning;
  return body;
}

const ANGLED_STATUSES = new Set<PhotoPregradeAngledStatus>([
  "not_provided",
  "graded",
  "rejected",
  "no_light_change",
  "solve_failed",
]);

/** cardflow_adapter.py `cardflow.angled` → public shape. Missing = not provided. */
function angledResult(report: Record<string, unknown>): PhotoPregradeAngled {
  const angled = asRecord(asRecord(report.cardflow)?.angled);
  const status = angled?.status;
  return {
    provided: asFiniteNumber(angled?.provided) ?? 0,
    used: asFiniteNumber(angled?.used) ?? 0,
    status:
      typeof status === "string" && ANGLED_STATUSES.has(status as PhotoPregradeAngledStatus)
        ? (status as PhotoPregradeAngledStatus)
        : "not_provided",
  };
}

function surfaceNullReason(status: PhotoPregradeAngledStatus): string {
  if (status === "no_light_change") return PREGRADE_COPY.surfaceAngledNoLight;
  if (status === "rejected" || status === "solve_failed") return PREGRADE_COPY.surfaceAngledFailed;
  return PREGRADE_SURFACE_NULL_REASON;
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
  if (pillars.surface.reason) trace.push(`surface: ${pillars.surface.reason}`);
  if (result.note) trace.push(result.note);
  if (result.warning) trace.push(`warning: ${result.warning}`);
  return {
    overall: result.estimate,
    display: `${PREGRADE_COPY.displayPrefix} ${result.estimate}`,
    confidence: null,
    subgrades,
    usedBack: true,
    label: GRADE_ESTIMATE_LABEL,
    notACert: true,
    disclaimer: GRADE_ESTIMATE_DISCLAIMER,
    mathTrace: trace,
  };
}
