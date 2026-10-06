export const SCAN_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

export const SCAN_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ScanImageMimeType = (typeof SCAN_IMAGE_MIME_TYPES)[number];

export interface ScanImageBytes {
  storageRef: string;
  mimeType: ScanImageMimeType;
  bytes: Uint8Array;
}

export function normalizeScanImageMime(
  value: string | null | undefined,
): ScanImageMimeType | null {
  if (!value) return null;
  const lowered = value.toLowerCase().split(";")[0]?.trim() ?? "";
  if (lowered === "image/jpg" || lowered === "image/jpeg") return "image/jpeg";
  if (lowered === "image/png") return "image/png";
  if (lowered === "image/webp") return "image/webp";
  return null;
}

/** JPEG, PNG, or WebP from the file bytes. A declared type is not enough. */
export function mimeFromImageMagic(bytes: Uint8Array): ScanImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function mimeFromFileName(name: string | null | undefined): ScanImageMimeType | null {
  if (!name) return null;
  const lowered = name.toLowerCase();
  if (lowered.endsWith(".jpg") || lowered.endsWith(".jpeg")) return "image/jpeg";
  if (lowered.endsWith(".png")) return "image/png";
  if (lowered.endsWith(".webp")) return "image/webp";
  return null;
}

export function scanImageExtension(mimeType: ScanImageMimeType): ".jpg" | ".png" | ".webp" {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

/** First-party object key, never a vendor URL. */
export function scanImageStorageRef(scanId: string, mimeType: ScanImageMimeType): string {
  return `scans/${scanId}${scanImageExtension(mimeType)}`;
}

export function isFirstPartyScanImageRef(storageRef: string): boolean {
  return /^scans\/[0-9a-f-]+\.(jpg|png|webp)$/i.test(storageRef);
}

export function mimeFromScanStorageRef(
  storageRef: string,
): ScanImageMimeType | null {
  if (!isFirstPartyScanImageRef(storageRef)) return null;
  const lowered = storageRef.toLowerCase();
  if (lowered.endsWith(".png")) return "image/png";
  if (lowered.endsWith(".webp")) return "image/webp";
  if (lowered.endsWith(".jpg")) return "image/jpeg";
  return null;
}
