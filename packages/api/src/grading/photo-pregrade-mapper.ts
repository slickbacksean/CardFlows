import { PREGRADE_DISCLAIMER, PREGRADE_LABEL } from '@cardflows/shared';
import type { PhotoSide } from './pregrade-photos.js';

export const PHOTO_PREGRADE_SOURCE = 'cardgrading-photo' as const;

const HARD_GATE_NAMES = new Set(['card_detection', 'tilt', 'aspect_ratio']);

const HARD_GATE_TIPS: Record<string, string> = {
  card_detection: 'Card not found',
  tilt: 'Camera angle too tilted',
  aspect_ratio: 'Unexpected aspect ratio',
};

const SOFT_GATE_LABELS: Record<string, string> = {
  resolution: 'Resolution too low',
  glare: 'Glare detected',
  uneven_lighting: 'Uneven lighting',
};

const SURFACE_NULL_REASON = 'single-image relief is not graded';
const SURFACE_EXCLUDED_NOTE = 'overall estimate excludes surface';
const DIMENSIONS_NOTE = 'dimensions not measured without dpi';

export interface PhotoPregradeSubgrade {
  points: number | null;
  front: number | null;
  back: number | null;
  reason?: string;
}

export interface PhotoPregradeSuccess {
  ok: true;
  label: string;
  disclaimer: string;
  source: typeof PHOTO_PREGRADE_SOURCE;
  estimate: number;
  subgrades: {
    centering: PhotoPregradeSubgrade;
    corners: PhotoPregradeSubgrade;
    edges: PhotoPregradeSubgrade;
    surface: PhotoPregradeSubgrade;
  };
  note: string;
  warning?: string;
}

export interface PhotoPregradeRetake {
  ok: false;
  code: 'PHOTO_RETAKE';
  side: PhotoSide;
  reasons: string[];
}

export type PhotoPregradeResult = PhotoPregradeSuccess | PhotoPregradeRetake;

interface LibraryGate {
  name?: unknown;
  passed?: unknown;
  detail?: unknown;
  hard?: unknown;
}

interface LibraryCaptureQuality {
  ok?: unknown;
  gates?: unknown;
}

interface LibrarySideGrades {
  centering?: unknown;
  corners?: unknown;
  edges?: unknown;
  surface?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asGates(value: unknown): LibraryGate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((gate) => isRecord(gate));
}

function isHardGate(gate: LibraryGate): boolean {
  if (typeof gate.name !== 'string') return false;
  if (typeof gate.hard === 'boolean') return gate.hard;
  return HARD_GATE_NAMES.has(gate.name);
}

function failedHardGates(quality: LibraryCaptureQuality | undefined): LibraryGate[] {
  if (!quality) return [];
  return asGates(quality.gates).filter((gate) => gate.passed === false && isHardGate(gate));
}

function hardGateReason(gate: LibraryGate): string {
  if (typeof gate.name === 'string' && gate.name in HARD_GATE_TIPS) {
    return HARD_GATE_TIPS[gate.name];
  }
  if (typeof gate.detail === 'string' && gate.detail.trim() !== '') return gate.detail;
  return 'Card not found';
}

function sideGrade(
  subgrades: Record<string, unknown> | null,
  side: PhotoSide,
  key: keyof LibrarySideGrades,
  fallback: unknown
): number | null {
  const fromSub = asRecord(subgrades?.[side]);
  const subValue = asFiniteNumber(fromSub?.[key]);
  if (subValue !== null) return subValue;
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
  back: number | null
): number | null {
  if (combined !== null) return combined * 10;
  return meanPoints(front, back);
}

function captureQuality(
  report: Record<string, unknown>,
  side: PhotoSide
): LibraryCaptureQuality | undefined {
  const quality = asRecord(report.capture_quality);
  const sideQuality = asRecord(quality?.[side]);
  return sideQuality ?? undefined;
}

function softGateWarning(report: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  for (const side of ['front', 'back'] as const) {
    const quality = captureQuality(report, side);
    const failed = asGates(quality?.gates).filter(
      (gate) => gate.passed === false && !isHardGate(gate) && typeof gate.name === 'string'
    );
    if (failed.length === 0) continue;
    const labels = failed.map((gate) => {
      const name = gate.name as string;
      return SOFT_GATE_LABELS[name] ?? name;
    });
    parts.push(`${side === 'front' ? 'Front' : 'Back'}: ${labels.join(', ')}`);
  }

  const pair = asRecord(report.capture_pair);
  if (pair?.same_side_suspected === true) {
    const note = typeof pair.note === 'string' && pair.note.trim() !== '' ? pair.note : null;
    parts.push(note ?? 'The front and back uploads look like the same side.');
  }

  if (parts.length === 0) return undefined;
  return parts.join(' ');
}

function retake(side: PhotoSide, reasons: string[]): PhotoPregradeRetake {
  return {
    ok: false,
    code: 'PHOTO_RETAKE',
    side,
    reasons: reasons.length > 0 ? reasons : ['Card not found'],
  };
}

function hardRetake(report: Record<string, unknown>): PhotoPregradeRetake | null {
  for (const side of ['front', 'back'] as const) {
    const failed = failedHardGates(captureQuality(report, side));
    if (failed.length > 0) {
      return retake(side, failed.map(hardGateReason));
    }
  }
  return null;
}

/**
 * Map a vendored `grade_card` report to the CardFlow photo-pregrade body.
 *
 * Library field names that differ from this body:
 * - `grade_estimate.overall_grade` → `estimate` (the only 1.0–10.0 number)
 * - `centering.overall_grade` → `subgrades.centering.points` (×10)
 * - `subgrades.{front,back}.{centering,corners,edges,surface}` → per-side grades
 * - corners/edges have no library-wide combined value, so `points` is the
 *   mean of the per-side grades ×10 (not `corners_edges.overall_grade`, which
 *   mixes both attributes)
 * - `overall_grade_rounded`, `score`, and every `by_grader` block are dropped
 */
export function mapGradeCardReport(input: unknown): PhotoPregradeResult {
  const report = asRecord(input) ?? {};

  const hard = hardRetake(report);
  if (hard) return hard;

  if (report.grade_estimate == null && report.centering == null) {
    return retake('front', ['Card not found']);
  }

  const estimateBlock = asRecord(report.grade_estimate);
  const estimate = asFiniteNumber(estimateBlock?.overall_grade);
  if (estimate === null) {
    return retake('front', ['Card not found']);
  }

  const centering = asRecord(report.centering);
  const cornersEdges = asRecord(report.corners_edges);
  const surface = asRecord(report.surface);
  const subgrades = asRecord(report.subgrades);
  const dimensions = asRecord(report.dimensions);

  const centeringFront = sideGrade(subgrades, 'front', 'centering', asRecord(centering?.front)?.grade);
  const centeringBack = sideGrade(subgrades, 'back', 'centering', asRecord(centering?.back)?.grade);
  const cornersFront = sideGrade(
    subgrades,
    'front',
    'corners',
    asRecord(cornersEdges?.front)?.corners_grade
  );
  const cornersBack = sideGrade(subgrades, 'back', 'corners', asRecord(cornersEdges?.back)?.corners_grade);
  const edgesFront = sideGrade(subgrades, 'front', 'edges', asRecord(cornersEdges?.front)?.edges_grade);
  const edgesBack = sideGrade(subgrades, 'back', 'edges', asRecord(cornersEdges?.back)?.edges_grade);
  const surfaceFront = sideGrade(subgrades, 'front', 'surface', asRecord(surface?.front)?.grade);
  const surfaceBack = sideGrade(subgrades, 'back', 'surface', asRecord(surface?.back)?.grade);

  const surfaceNull = surfaceFront === null && surfaceBack === null;
  const noteParts = [];
  if (surfaceNull) noteParts.push(SURFACE_EXCLUDED_NOTE);
  if (dimensions?.measurable === false) noteParts.push(DIMENSIONS_NOTE);

  const body: PhotoPregradeSuccess = {
    ok: true,
    label: PREGRADE_LABEL,
    disclaimer: PREGRADE_DISCLAIMER,
    source: PHOTO_PREGRADE_SOURCE,
    estimate,
    subgrades: {
      centering: {
        points: combinedPoints(asFiniteNumber(centering?.overall_grade), centeringFront, centeringBack),
        front: centeringFront,
        back: centeringBack,
      },
      corners: {
        points: meanPoints(cornersFront, cornersBack),
        front: cornersFront,
        back: cornersBack,
      },
      edges: {
        points: meanPoints(edgesFront, edgesBack),
        front: edgesFront,
        back: edgesBack,
      },
      surface: {
        points: surfaceNull ? null : meanPoints(surfaceFront, surfaceBack),
        front: surfaceFront,
        back: surfaceBack,
        ...(surfaceNull ? { reason: SURFACE_NULL_REASON } : {}),
      },
    },
    note: noteParts.join('; '),
  };

  const warning = softGateWarning(report);
  if (warning) body.warning = warning;
  return body;
}
