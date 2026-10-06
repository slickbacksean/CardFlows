export const PREGRADE_MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export type PhotoMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface GradingPhoto {
  uri: string;
  mimeType: PhotoMime;
  fileName: string;
  fileSize?: number;
  /** Computer-vision crop preview. Never treat the raw snapshot as the crop. */
  cropUri?: string;
  detected?: boolean;
  warnings?: string[];
}

const ALLOWED: readonly PhotoMime[] = ['image/jpeg', 'image/png', 'image/webp'];

export function mimeFromName(name: string, fallback?: string | null): PhotoMime | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png') || fallback === 'image/png') return 'image/png';
  if (lower.endsWith('.webp') || fallback === 'image/webp') return 'image/webp';
  if (
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    fallback === 'image/jpeg' ||
    fallback === 'image/jpg'
  ) {
    return 'image/jpeg';
  }
  if (fallback === 'image/png' || fallback === 'image/webp' || fallback === 'image/jpeg') {
    return fallback;
  }
  return null;
}

export function fileNameFor(side: 'front' | 'back', mimeType: PhotoMime): string {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `${side}.${ext}`;
}

export function validatePhoto(photo: Pick<GradingPhoto, 'mimeType' | 'fileSize'>): string[] {
  const reasons: string[] = [];
  if (!ALLOWED.includes(photo.mimeType)) {
    reasons.push('Use a JPEG, PNG, or WebP photo.');
  }
  if (photo.fileSize !== undefined && photo.fileSize > PREGRADE_MAX_PHOTO_BYTES) {
    reasons.push('Use a photo under 10 MB.');
  }
  return reasons;
}

export async function readPhotoSize(uri: string): Promise<number | undefined> {
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    return blob.size;
  } catch {
    return undefined;
  }
}
