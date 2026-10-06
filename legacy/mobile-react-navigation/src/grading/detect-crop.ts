export interface DetectedCropPayload {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}

export interface DetectCropSuccess {
  ok: true;
  side: 'front' | 'back';
  cropUri: string;
  warnings: string[];
}

export interface DetectCropRetake {
  ok: false;
  code: 'PHOTO_RETAKE';
  side: 'front' | 'back';
  reasons: string[];
  cropUri?: string;
}

export interface DetectCropUnavailable {
  ok: false;
  code: 'UNAVAILABLE';
  message: string;
}

export type DetectCropResponse = DetectCropSuccess | DetectCropRetake | DetectCropUnavailable;

const DEFAULT_RETAKE = 'No card found, too much tilt, or a bad aspect ratio. Retake the photo.';
const DEFAULT_UNAVAILABLE = 'Card detection is not available.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

export function cropToDataUri(crop: DetectedCropPayload | null | undefined): string | undefined {
  if (!crop || typeof crop.base64 !== 'string' || crop.base64.trim() === '') return undefined;
  const mime = crop.mimeType || 'image/jpeg';
  return `data:${mime};base64,${crop.base64}`;
}

function asCrop(value: unknown): DetectedCropPayload | null {
  if (!isRecord(value)) return null;
  if (typeof value.base64 !== 'string' || value.base64.trim() === '') return null;
  const mimeType =
    value.mimeType === 'image/png' || value.mimeType === 'image/webp' ? value.mimeType : 'image/jpeg';
  return { mimeType, base64: value.base64 };
}

export function parseDetectCropSuccess(body: unknown): DetectCropSuccess | null {
  if (!isRecord(body) || body.ok !== true) return null;
  const cropUri = cropToDataUri(asCrop(body.crop));
  if (!cropUri) return null;
  return {
    ok: true,
    side: body.side === 'back' ? 'back' : 'front',
    cropUri,
    warnings: asWarnings(body.warnings),
  };
}

export function parseDetectCropRetake(body: unknown): DetectCropRetake | null {
  if (!isRecord(body) || body.code !== 'PHOTO_RETAKE') return null;
  const reasons = asWarnings(body.reasons);
  const cropUri = cropToDataUri(asCrop(body.crop));
  return {
    ok: false,
    code: 'PHOTO_RETAKE',
    side: body.side === 'back' ? 'back' : 'front',
    reasons: reasons.length > 0 ? reasons : [DEFAULT_RETAKE],
    ...(cropUri ? { cropUri } : {}),
  };
}

export function parseDetectCropUnavailable(body: unknown): DetectCropUnavailable | null {
  if (!isRecord(body) || body.code !== 'UNAVAILABLE') return null;
  const message = typeof body.message === 'string' && body.message.trim() !== '' ? body.message : DEFAULT_UNAVAILABLE;
  return { ok: false, code: 'UNAVAILABLE', message };
}

export function canConfirmDetectedCrop(
  detected: boolean | undefined,
  localReasons: string[],
  apiReasons: string[]
): boolean {
  return detected === true && localReasons.length === 0 && apiReasons.length === 0;
}

export function shouldRequestPhotoGradeAfterConfirm(
  side: 'front' | 'back',
  frontDetected: boolean,
  backDetected: boolean
): boolean {
  if (side === 'front' && !backDetected) return false;
  return frontDetected && backDetected;
}
