import { describe, expect, it } from "vitest";
import { jpegOrientation, orientRgb } from "./obb-phash-decode";
import type { RgbBitmap } from "@cardflow/shared";

function bitmap(width: number, height: number, paint: (x: number, y: number) => number): RgbBitmap {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[(y * width + x) * 3] = paint(x, y);
    }
  }
  return { width, height, data };
}

function pixel(image: RgbBitmap, x: number, y: number): number {
  return image.data[(y * image.width + x) * 3] ?? 0;
}

/** Big-endian TIFF with a single Orientation tag. */
function exifJpeg(orientation: number): Uint8Array {
  const tiff = [
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00,
    0x00, 0x00, 0x01, (orientation >> 8) & 0xff, orientation & 0xff, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00,
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const length = payload.length + 2;
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payload, 0xff, 0xd9,
  ]);
}

describe("scan JPEG orientation", () => {
  it("reads an iPhone-style orientation 6 tag", () => {
    expect(jpegOrientation(exifJpeg(6))).toBe(6);
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(1);
  });

  it("rotates orientation 6 clockwise", () => {
    const source = bitmap(2, 1, (x) => (x === 0 ? 10 : 20));
    const turned = orientRgb(source, 6);
    expect(turned.width).toBe(1);
    expect(turned.height).toBe(2);
    expect(pixel(turned, 0, 0)).toBe(10);
    expect(pixel(turned, 0, 1)).toBe(20);
  });
});
