import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import type { RecognitionImageMimeType, RgbBitmap } from "@cardflow/shared";

function rgbaToRgb(rgba: Uint8Array, width: number, height: number): RgbBitmap {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    data[i * 3] = rgba[i * 4] ?? 0;
    data[i * 3 + 1] = rgba[i * 4 + 1] ?? 0;
    data[i * 3 + 2] = rgba[i * 4 + 2] ?? 0;
  }
  return { width, height, data };
}

function readU16(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint16(offset, littleEndian);
}

function readU32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(offset, littleEndian);
}

/** EXIF orientation (1–8). 1 when the tag is missing. iPhone stills are often 6. */
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let index = 2;
  while (index + 4 < bytes.length) {
    if (bytes[index] !== 0xff) break;
    const marker = bytes[index + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      index += 2;
      continue;
    }
    const segmentLength = ((bytes[index + 2] ?? 0) << 8) | (bytes[index + 3] ?? 0);
    if (segmentLength < 2 || index + 2 + segmentLength > bytes.length) break;
    const isExif =
      marker === 0xe1 &&
      segmentLength >= 16 &&
      bytes[index + 4] === 0x45 &&
      bytes[index + 5] === 0x78 &&
      bytes[index + 6] === 0x69 &&
      bytes[index + 7] === 0x66;
    if (isExif) {
      const orientation = orientationFromTiff(bytes.subarray(index + 10, index + 2 + segmentLength));
      if (orientation >= 1 && orientation <= 8) return orientation;
    }
    index += 2 + segmentLength;
  }
  return 1;
}

function orientationFromTiff(tiff: Uint8Array): number {
  if (tiff.length < 8) return 1;
  const littleEndian = tiff[0] === 0x49 && tiff[1] === 0x49;
  const bigEndian = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!littleEndian && !bigEndian) return 1;
  const ifdOffset = readU32(tiff, 4, littleEndian);
  if (ifdOffset + 2 > tiff.length) return 1;
  const count = readU16(tiff, ifdOffset, littleEndian);
  for (let entry = 0; entry < count; entry++) {
    const offset = ifdOffset + 2 + entry * 12;
    if (offset + 12 > tiff.length) break;
    const tag = readU16(tiff, offset, littleEndian);
    if (tag !== 0x0112) continue;
    return readU16(tiff, offset + 8, littleEndian);
  }
  return 1;
}

function copyPixel(src: Uint8Array, srcIndex: number, dst: Uint8Array, dstIndex: number) {
  dst[dstIndex] = src[srcIndex] ?? 0;
  dst[dstIndex + 1] = src[srcIndex + 1] ?? 0;
  dst[dstIndex + 2] = src[srcIndex + 2] ?? 0;
}

function mapRgb(
  image: RgbBitmap,
  width: number,
  height: number,
  point: (x: number, y: number) => { x: number; y: number },
): RgbBitmap {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const dest = point(x, y);
      copyPixel(
        image.data,
        (y * image.width + x) * 3,
        data,
        (dest.y * width + dest.x) * 3,
      );
    }
  }
  return { width, height, data };
}

/** Bake EXIF orientation into pixels. Catalog art is upright; phone JPEGs often are not. */
export function orientRgb(image: RgbBitmap, orientation: number): RgbBitmap {
  const width = image.width;
  const height = image.height;
  switch (orientation) {
    case 2:
      return mapRgb(image, width, height, (x, y) => ({ x: width - 1 - x, y }));
    case 3:
      return mapRgb(image, width, height, (x, y) => ({ x: width - 1 - x, y: height - 1 - y }));
    case 4:
      return mapRgb(image, width, height, (x, y) => ({ x, y: height - 1 - y }));
    case 5:
      return mapRgb(image, height, width, (x, y) => ({ x: y, y: x }));
    case 6:
      return mapRgb(image, height, width, (x, y) => ({ x: height - 1 - y, y: x }));
    case 7:
      return mapRgb(image, height, width, (x, y) => ({ x: height - 1 - y, y: width - 1 - x }));
    case 8:
      return mapRgb(image, height, width, (x, y) => ({ x: y, y: width - 1 - x }));
    default:
      return image;
  }
}

/** Decode a Capture still. WebP waits on native decode; never CardSight or Pocket blobs. */
export async function decodeScanStill(
  image: Uint8Array,
  mimeType: RecognitionImageMimeType,
): Promise<RgbBitmap | null> {
  if (image.byteLength === 0) return null;
  try {
    const buffer = Buffer.from(image);
    if (mimeType === "image/jpeg") {
      const decoded = jpeg.decode(buffer, { useTArray: true });
      const bitmap = rgbaToRgb(decoded.data, decoded.width, decoded.height);
      return orientRgb(bitmap, jpegOrientation(image));
    }
    if (mimeType === "image/png") {
      const png = PNG.sync.read(buffer);
      return rgbaToRgb(png.data, png.width, png.height);
    }
    return null;
  } catch {
    return null;
  }
}

export function encodePngStill(bitmap: RgbBitmap): Uint8Array {
  const png = new PNG({ width: bitmap.width, height: bitmap.height });
  for (let i = 0; i < bitmap.width * bitmap.height; i++) {
    png.data[i * 4] = bitmap.data[i * 3] ?? 0;
    png.data[i * 4 + 1] = bitmap.data[i * 3 + 1] ?? 0;
    png.data[i * 4 + 2] = bitmap.data[i * 3 + 2] ?? 0;
    png.data[i * 4 + 3] = 255;
  }
  return new Uint8Array(PNG.sync.write(png));
}
