import { isDecodableRasterImage } from './decode-image.js';

export const PREGRADE_MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type PhotoSide = 'front' | 'back';

export interface PhotoRetakeError {
  ok: false;
  code: 'PHOTO_RETAKE';
  side: PhotoSide;
  reasons: string[];
}

function isUpload(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

export async function inspectPregradePhoto(
  value: unknown,
  side: PhotoSide
): Promise<{ ok: true } | { ok: false; reasons: string[] }> {
  if (!isUpload(value)) {
    return { ok: false, reasons: [`Add a ${side} photo.`] };
  }

  if (!ALLOWED_PHOTO_TYPES.has(value.type)) {
    return { ok: false, reasons: ['Use a JPEG, PNG, or WebP photo.'] };
  }

  if (value.size > PREGRADE_MAX_PHOTO_BYTES) {
    return { ok: false, reasons: ['Use a photo under 10 MB.'] };
  }

  const bytes = Buffer.from(await value.arrayBuffer());
  if (bytes.byteLength > PREGRADE_MAX_PHOTO_BYTES) {
    return { ok: false, reasons: ['Use a photo under 10 MB.'] };
  }

  if (!isDecodableRasterImage(bytes)) {
    return { ok: false, reasons: ['The photo could not be read. Try another JPEG, PNG, or WebP.'] };
  }

  return { ok: true };
}

export async function inspectPregradePhotos(
  front: unknown,
  back: unknown
): Promise<PhotoRetakeError | null> {
  const frontResult = await inspectPregradePhoto(front, 'front');
  const backResult = await inspectPregradePhoto(back, 'back');

  if (!frontResult.ok) {
    return { ok: false, code: 'PHOTO_RETAKE', side: 'front', reasons: frontResult.reasons };
  }
  if (!backResult.ok) {
    return { ok: false, code: 'PHOTO_RETAKE', side: 'back', reasons: backResult.reasons };
  }
  return null;
}
