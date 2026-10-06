export const PHOTO_GRADE_LABEL = 'AI pre-grade estimate';
export const PHOTO_GRADE_DISCLAIMER = 'Not an official PSA, BGS, or CGC grade.';
export const SURFACE_EXCLUDED_NOTE =
  'Overall estimate excludes surface — a single photo is not graded for surface.';

export interface PhotoPregradeSuccess {
  estimate: number;
  label: string;
  disclaimer: string;
  note: string;
  warnings: string[];
  centering: number | null;
  corners: number | null;
  edges: number | null;
  surface: number | null;
}

export interface PhotoPregradeRetake {
  ok: false;
  code: 'PHOTO_RETAKE';
  side: 'front' | 'back';
  reasons: string[];
}

export interface PhotoPregradeUnavailable {
  ok: false;
  code: 'UNAVAILABLE';
  message: string;
}

export type PhotoPregradeResponse =
  | ({ ok: true } & PhotoPregradeSuccess)
  | PhotoPregradeRetake
  | PhotoPregradeUnavailable;

const HARD_GATE = /card not found|no card(?: found)?|card_detection|tilt|aspect(?:[_\s-]?ratio)?/i;
const SOFT_WARNING = /glare|lighting|resolution/i;
const DEFAULT_RETAKE = 'No card found, too much tilt, or a bad aspect ratio. Retake the photo.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function nestedEstimate(body: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(body.grade_estimate) ? body.grade_estimate : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function subgradeNumber(body: Record<string, unknown>, key: string): number | null {
  const flat = asNumber(body[key]);
  if (flat !== null) return flat;

  const block = asRecord(asRecord(body.subgrades)?.[key]);
  if (!block) return null;

  const front = asNumber(block.front);
  const back = asNumber(block.back);
  const sides = [front, back].filter((value): value is number => value !== null);
  if (sides.length > 0) return sides.reduce((sum, value) => sum + value, 0) / sides.length;

  const points = asNumber(block.points);
  if (points === null) return null;
  return points > 10 ? points / 10 : points;
}

function warningList(body: Record<string, unknown>): string[] {
  const extra = typeof body.warning === 'string' && body.warning.trim() !== '' ? [body.warning] : [];
  return collectPhotoWarnings(body.warnings, body.reasons, extra, nestedEstimate(body)?.warnings);
}

export function isHardGateReason(reason: string): boolean {
  return HARD_GATE.test(reason);
}

export function isSoftWarning(reason: string): boolean {
  return SOFT_WARNING.test(reason) && !HARD_GATE.test(reason);
}

export function filterRetakeReasons(reasons: string[]): string[] {
  return reasons.filter(isHardGateReason);
}

export function collectPhotoWarnings(...groups: unknown[]): string[] {
  return unique(groups.flatMap(asWarnings).filter(isSoftWarning));
}

export function parsePhotoPregradeSuccess(body: unknown): PhotoPregradeSuccess | null {
  if (!isRecord(body)) return null;
  if (body.ok === false) return null;
  if (body.code === 'PHOTO_RETAKE') return null;

  const nested = nestedEstimate(body);
  const estimate = asNumber(body.estimate) ?? asNumber(nested?.overall_grade);
  if (estimate === null) return null;

  const corners =
    asNumber(body.corners) ??
    asNumber(body.corners_edges) ??
    asNumber(nested?.corners_edges_grade) ??
    asNumber(nested?.corners_grade) ??
    subgradeNumber(body, 'corners');
  const edges =
    asNumber(body.edges) ?? asNumber(nested?.edges_grade) ?? subgradeNumber(body, 'edges') ?? corners;

  return {
    estimate,
    label: PHOTO_GRADE_LABEL,
    disclaimer: PHOTO_GRADE_DISCLAIMER,
    note: typeof body.note === 'string' && body.note.trim() !== '' ? body.note : SURFACE_EXCLUDED_NOTE,
    warnings: warningList(body),
    centering:
      asNumber(body.centering) ?? asNumber(nested?.centering_grade) ?? subgradeNumber(body, 'centering'),
    corners,
    edges,
    surface: asNumber(body.surface) ?? asNumber(nested?.surface_grade) ?? subgradeNumber(body, 'surface'),
  };
}

export function parsePhotoPregradeRetake(body: unknown): PhotoPregradeRetake | null {
  if (!isRecord(body)) return null;
  if (body.code !== 'PHOTO_RETAKE') return null;
  const side = body.side === 'back' ? 'back' : 'front';
  const reasons = filterRetakeReasons(asWarnings(body.reasons));
  return {
    ok: false,
    code: 'PHOTO_RETAKE',
    side,
    reasons: reasons.length > 0 ? reasons : [DEFAULT_RETAKE],
  };
}
