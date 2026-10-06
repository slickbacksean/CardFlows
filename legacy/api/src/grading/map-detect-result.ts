import type { PhotoSide } from './pregrade-photos.js';

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

export interface DetectedCrop {
  mimeType: 'image/jpeg';
  base64: string;
}

export interface DetectCropSuccess {
  ok: true;
  side: PhotoSide;
  crop: DetectedCrop;
  warnings: string[];
}

export interface DetectCropRetake {
  ok: false;
  code: 'PHOTO_RETAKE';
  side: PhotoSide;
  reasons: string[];
  crop?: DetectedCrop;
}

export type DetectCropMapped = DetectCropSuccess | DetectCropRetake;

interface LibraryGate {
  name?: unknown;
  passed?: unknown;
  detail?: unknown;
  hard?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function hardGateReason(gate: LibraryGate): string {
  if (typeof gate.name === 'string' && gate.name in HARD_GATE_TIPS) {
    return HARD_GATE_TIPS[gate.name];
  }
  if (typeof gate.detail === 'string' && gate.detail.trim() !== '') return gate.detail;
  return 'Card not found';
}

function softWarnings(gates: LibraryGate[]): string[] {
  return gates
    .filter((gate) => gate.passed === false && !isHardGate(gate) && typeof gate.name === 'string')
    .map((gate) => SOFT_GATE_LABELS[gate.name as string] ?? (gate.name as string));
}

function toCrop(cropBytes: Buffer | null): DetectedCrop | undefined {
  if (!cropBytes || cropBytes.byteLength === 0) return undefined;
  return { mimeType: 'image/jpeg', base64: cropBytes.toString('base64') };
}

export function mapDetectReport(
  input: unknown,
  side: PhotoSide,
  cropBytes: Buffer | null
): DetectCropMapped {
  const report = isRecord(input) ? input : {};
  const gates = asGates(report.gates);
  const hardFailures = gates.filter((gate) => gate.passed === false && isHardGate(gate));
  const crop = toCrop(cropBytes);

  if (hardFailures.length > 0) {
    const body: DetectCropRetake = {
      ok: false,
      code: 'PHOTO_RETAKE',
      side,
      reasons: hardFailures.map(hardGateReason),
    };
    if (crop) body.crop = crop;
    return body;
  }

  if (!crop) {
    return {
      ok: false,
      code: 'PHOTO_RETAKE',
      side,
      reasons: ['Card not found'],
    };
  }

  return {
    ok: true,
    side,
    crop,
    warnings: softWarnings(gates),
  };
}
