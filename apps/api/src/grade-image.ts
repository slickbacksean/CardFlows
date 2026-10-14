import {
  GRADE_SIDES,
  GRADE_STILL_MAX_LONG_EDGE_PX,
  GRADE_STILL_TOO_LARGE_COPY,
  type GradeImageMimeType,
  type GradeSide,
} from "@cardflow/shared";
import { scanImageExtension, type ScanImageBytes, type ScanImageMimeType } from "./scan-image";

export type GradeImageBytes = ScanImageBytes;

export interface ImageHeaderSize {
  width: number;
  height: number;
}

export interface StagedGradeStill {
  bytes: Uint8Array;
  mimeType: GradeImageMimeType;
}

export interface GradeUploadCache {
  stage(userId: string, side: GradeSide, still: StagedGradeStill): string;
  get(userId: string, id: string, side: GradeSide): StagedGradeStill | undefined;
}

export function isGradePhotoSide(value: string | undefined): value is GradeSide {
  return (GRADE_SIDES as readonly string[]).includes(value ?? "");
}

/** First-party object key, never a vendor or catalog URL. */
export function safeGradeInventoryId(inventoryItemId: string): string {
  const safe = inventoryItemId.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  return safe.length > 0 ? safe.slice(0, 80) : "item";
}

export function gradeImageStorageRef(
  inventoryItemId: string,
  side: GradeSide,
  mimeType: ScanImageMimeType,
): string {
  return `grade/${safeGradeInventoryId(inventoryItemId)}-${side}${scanImageExtension(mimeType)}`;
}

export function isFirstPartyGradeImageRef(storageRef: string): boolean {
  return /^grade\/[A-Za-z0-9._-]+-(front|back)\.(jpg|png|webp)$/i.test(storageRef);
}

export function mimeFromGradeStorageRef(storageRef: string): ScanImageMimeType | null {
  if (!isFirstPartyGradeImageRef(storageRef)) return null;
  const lowered = storageRef.toLowerCase();
  if (lowered.endsWith(".png")) return "image/png";
  if (lowered.endsWith(".webp")) return "image/webp";
  if (lowered.endsWith(".jpg")) return "image/jpeg";
  return null;
}

export function gradeImageStorageCandidates(
  inventoryItemId: string,
  side: GradeSide,
): string[] {
  return [
    gradeImageStorageRef(inventoryItemId, side, "image/jpeg"),
    gradeImageStorageRef(inventoryItemId, side, "image/png"),
    gradeImageStorageRef(inventoryItemId, side, "image/webp"),
  ];
}

/**
 * Width × height from the JPEG/PNG/WebP header only. Never decodes pixels.
 * Returns null when the header has no size (including the tiny SOI/EOI fixtures).
 */
export function readImageHeaderSize(bytes: Uint8Array): ImageHeaderSize | null {
  const jpeg = jpegHeaderSize(bytes);
  if (jpeg) return jpeg;
  const png = pngHeaderSize(bytes);
  if (png) return png;
  return webpHeaderSize(bytes);
}

/** Reject oversized dimensions from the header. Missing size is not a reject (do not decode). */
export function oversizedImageHeaderError(
  bytes: Uint8Array,
): { error: string; status: 400 } | null {
  const size = readImageHeaderSize(bytes);
  if (!size) return null;
  if (Math.max(size.width, size.height) > GRADE_STILL_MAX_LONG_EDGE_PX) {
    return { error: GRADE_STILL_TOO_LARGE_COPY, status: 400 };
  }
  return null;
}

export function createGradeUploadCache(options?: {
  ttlMs?: number;
  now?: () => number;
  maxEntries?: number;
}): GradeUploadCache {
  const ttlMs = options?.ttlMs ?? 15 * 60 * 1000;
  const now = options?.now ?? Date.now;
  const maxEntries = options?.maxEntries ?? 64;
  const entries = new Map<
    string,
    { userId: string; side: GradeSide; still: StagedGradeStill; expiresAt: number }
  >();

  function sweep() {
    const t = now();
    for (const [id, entry] of entries) {
      if (entry.expiresAt <= t) entries.delete(id);
    }
    while (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value;
      if (!oldest) break;
      entries.delete(oldest);
    }
  }

  return {
    stage(userId, side, still) {
      sweep();
      const id = crypto.randomUUID();
      entries.set(id, { userId, side, still, expiresAt: now() + ttlMs });
      return id;
    },
    get(userId, id, side) {
      sweep();
      const entry = entries.get(id);
      if (!entry || entry.userId !== userId || entry.side !== side) return undefined;
      return entry.still;
    },
  };
}

export const gradeUploadCache = createGradeUploadCache();

function jpegHeaderSize(bytes: Uint8Array): ImageHeaderSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let index = 2;
  while (index + 8 < bytes.length) {
    if (bytes[index] !== 0xff) return null;
    const marker = bytes[index + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      index += 2;
      continue;
    }
    const segmentLength = ((bytes[index + 2] ?? 0) << 8) | (bytes[index + 3] ?? 0);
    if (segmentLength < 2 || index + 2 + segmentLength > bytes.length) return null;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && segmentLength >= 7) {
      const height = ((bytes[index + 5] ?? 0) << 8) | (bytes[index + 6] ?? 0);
      const width = ((bytes[index + 7] ?? 0) << 8) | (bytes[index + 8] ?? 0);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    index += 2 + segmentLength;
  }
  return null;
}

function pngHeaderSize(bytes: Uint8Array): ImageHeaderSize | null {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    return null;
  }
  if (
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    return null;
  }
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  if (width > 0 && height > 0) return { width, height };
  return null;
}

function webpHeaderSize(bytes: Uint8Array): ImageHeaderSize | null {
  if (
    bytes.length < 30 ||
    bytes[0] !== 0x52 ||
    bytes[1] !== 0x49 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x46 ||
    bytes[8] !== 0x57 ||
    bytes[9] !== 0x45 ||
    bytes[10] !== 0x42 ||
    bytes[11] !== 0x50
  ) {
    return null;
  }
  const chunk = String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0);
  if (chunk === "VP8X" && bytes.length >= 30) {
    const width = readU24LE(bytes, 24) + 1;
    const height = readU24LE(bytes, 27) + 1;
    if (width > 0 && height > 0) return { width, height };
    return null;
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    let offset = 20;
    while (offset + 10 < bytes.length && !(bytes[offset] === 0x9d && bytes[offset + 1] === 0x01 && bytes[offset + 2] === 0x2a)) {
      offset += 1;
    }
    if (offset + 6 >= bytes.length) return null;
    const width = ((bytes[offset + 3] ?? 0) | ((bytes[offset + 4] ?? 0) << 8)) & 0x3fff;
    const height = ((bytes[offset + 5] ?? 0) | ((bytes[offset + 6] ?? 0) << 8)) & 0x3fff;
    if (width > 0 && height > 0) return { width, height };
    return null;
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits =
      (bytes[21] ?? 0) | ((bytes[22] ?? 0) << 8) | ((bytes[23] ?? 0) << 16) | ((bytes[24] ?? 0) << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}
