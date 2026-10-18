import { describe, expect, it } from "vitest";
import { GRADE_STILL_MAX_LONG_EDGE_PX, GRADE_STILL_TOO_LARGE_COPY } from "@cardflow/shared";
import {
  createGradeUploadCache,
  gradeImageStorageCandidates,
  gradeImageStorageRef,
  imageCarriesExif,
  imageCarriesGps,
  isFirstPartyGradeImageRef,
  isGradePhotoSide,
  mimeFromGradeStorageRef,
  oversizedImageHeaderError,
  readImageHeaderSize,
  safeGradeInventoryId,
  stripImageMetadata,
} from "./grade-image";

function jpegSof(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
}

function pngIhdr(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}

function webpVp8x(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50], 0);
  bytes.set([0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00], 12);
  const w = width - 1;
  const h = height - 1;
  bytes[24] = w & 0xff;
  bytes[25] = (w >> 8) & 0xff;
  bytes[26] = (w >> 16) & 0xff;
  bytes[27] = h & 0xff;
  bytes[28] = (h >> 8) & 0xff;
  bytes[29] = (h >> 16) & 0xff;
  return bytes;
}

describe("first-party grade photo keys", () => {
  it("builds a first-party object key and never a catalog or vendor URL", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const ref = gradeImageStorageRef(id, "back", "image/jpeg");
    expect(ref).toBe(`grade/${id}-back.jpg`);
    expect(isFirstPartyGradeImageRef(ref)).toBe(true);
    expect(mimeFromGradeStorageRef(ref)).toBe("image/jpeg");
    expect(isGradePhotoSide("front")).toBe(true);
    expect(isGradePhotoSide("side")).toBe(false);
    expect(isFirstPartyGradeImageRef("https://assets.tcgdex.net/en/base/base1/58/high.webp")).toBe(
      false,
    );
    expect(isFirstPartyGradeImageRef("https://api.casecomp.xyz/grade")).toBe(false);
    expect(isFirstPartyGradeImageRef(`scans/${id}.jpg`)).toBe(false);
  });

  it("sanitizes inventory ids so paths stay under grade/", () => {
    expect(safeGradeInventoryId("pc:purchased:12")).toBe("pc_purchased_12");
    expect(safeGradeInventoryId("../etc/passwd")).toBe(".._etc_passwd");
    expect(gradeImageStorageCandidates("pc:purchased:12", "front")).toEqual([
      "grade/pc_purchased_12-front.jpg",
      "grade/pc_purchased_12-front.png",
      "grade/pc_purchased_12-front.webp",
    ]);
  });
});

describe("image header size (no pixel decode)", () => {
  it("reads JPEG SOF, PNG IHDR, and WebP VP8X sizes from a tiny buffer", () => {
    expect(readImageHeaderSize(jpegSof(4032, 3024))).toEqual({ width: 4032, height: 3024 });
    expect(readImageHeaderSize(pngIhdr(1200, 1600))).toEqual({ width: 1200, height: 1600 });
    expect(readImageHeaderSize(webpVp8x(2000, 1500))).toEqual({ width: 2000, height: 1500 });
    expect(readImageHeaderSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });

  it("rejects a long edge over 4032 from the header and allows 4032", () => {
    expect(GRADE_STILL_MAX_LONG_EDGE_PX).toBe(4032);
    expect(oversizedImageHeaderError(jpegSof(4032, 3024))).toBeNull();
    expect(oversizedImageHeaderError(jpegSof(4033, 1))).toEqual({
      error: GRADE_STILL_TOO_LARGE_COPY,
      status: 400,
    });
    expect(oversizedImageHeaderError(pngIhdr(1, 8000))).toEqual({
      error: GRADE_STILL_TOO_LARGE_COPY,
      status: 400,
    });
    expect(oversizedImageHeaderError(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });
});

describe("grade upload cache", () => {
  it("returns a still only to the same user and side before TTL", () => {
    let now = 1_000;
    const cache = createGradeUploadCache({ now: () => now, ttlMs: 1_000 });
    const still = { bytes: jpegSof(100, 100), mimeType: "image/jpeg" as const };
    const id = cache.stage("user-a", "front", still);
    expect(cache.get("user-a", id, "front")?.bytes).toEqual(still.bytes);
    expect(cache.get("user-b", id, "front")).toBeUndefined();
    expect(cache.get("user-a", id, "back")).toBeUndefined();
    now = 2_001;
    expect(cache.get("user-a", id, "front")).toBeUndefined();
  });

  it("releases a staged still after grading and all stills for an account", () => {
    const cache = createGradeUploadCache();
    const still = { bytes: jpegSof(100, 100), mimeType: "image/jpeg" as const };
    const front = cache.stage("user-a", "front", still);
    const keep = cache.stage("user-b", "front", still);
    expect(cache.release("user-a", front)).toBe(true);
    expect(cache.get("user-a", front, "front")).toBeUndefined();
    expect(cache.releaseUser("user-b")).toBe(1);
    expect(cache.get("user-b", keep, "front")).toBeUndefined();
  });
});

/** Big-endian TIFF with a GPS IFD pointer (tag 0x8825). */
function gpsTiff(): number[] {
  return [
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x88, 0x25, 0x00, 0x04, 0x00,
    0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ];
}

function jpegWithGpsExif(): Uint8Array {
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...gpsTiff()];
  const length = payload.length + 2;
  const sof = jpegSof(32, 32).subarray(2);
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payload, ...sof,
  ]);
}

function pngChunk(type: string, data: number[]): number[] {
  const length = data.length;
  const chars = [...type].map((ch) => ch.charCodeAt(0));
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...chars,
    ...data,
    0, 0, 0, 0,
  ];
}

function pngWithExif(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk("IHDR", [0, 0, 0, 8, 0, 0, 0, 8, 8, 2, 0, 0, 0]),
    ...pngChunk("eXIf", gpsTiff()),
    ...pngChunk("IEND", []),
  ]);
}

function webpWithExif(): Uint8Array {
  const vp8x = webpVp8x(8, 8).subarray(12);
  const exif = [0x45, 0x58, 0x49, 0x46, gpsTiff().length, 0, 0, 0, ...gpsTiff()];
  const body = [...vp8x, ...exif];
  const riffSize = 4 + body.length;
  return Uint8Array.from([
    0x52, 0x49, 0x46, 0x46,
    riffSize & 0xff, (riffSize >> 8) & 0xff, (riffSize >> 16) & 0xff, (riffSize >> 24) & 0xff,
    0x57, 0x45, 0x42, 0x50,
    ...body,
  ]);
}

describe("server-side EXIF/GPS strip", () => {
  it("drops JPEG EXIF and GPS without changing a clean still", () => {
    const dirty = jpegWithGpsExif();
    expect(imageCarriesExif(dirty)).toBe(true);
    expect(imageCarriesGps(dirty)).toBe(true);
    const clean = stripImageMetadata(dirty, "image/jpeg");
    expect(imageCarriesExif(clean)).toBe(false);
    expect(imageCarriesGps(clean)).toBe(false);
    expect(readImageHeaderSize(clean)).toEqual({ width: 32, height: 32 });

    const already = jpegSof(64, 48);
    expect(stripImageMetadata(already, "image/jpeg")).toBe(already);
  });

  it("drops PNG eXIf and WebP EXIF chunks", () => {
    const png = pngWithExif();
    expect(imageCarriesExif(png)).toBe(true);
    expect(imageCarriesGps(png)).toBe(true);
    const pngClean = stripImageMetadata(png, "image/png");
    expect(imageCarriesExif(pngClean)).toBe(false);
    expect(imageCarriesGps(pngClean)).toBe(false);

    const webp = webpWithExif();
    expect(imageCarriesExif(webp)).toBe(true);
    const webpClean = stripImageMetadata(webp, "image/webp");
    expect(imageCarriesExif(webpClean)).toBe(false);
  });
});
