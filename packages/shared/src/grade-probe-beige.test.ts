import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gradeProbeDetail, type GrayImage } from "./phone-photo-check";

/** Binary PGM (P5) → GrayImage. */
function readPgm(file: string): GrayImage {
  const buf = readFileSync(file);
  const header = buf.toString("latin1", 0, 64).split(/\s+/);
  const [, w, h, max] = header;
  const width = Number(w);
  const height = Number(h);
  const headerLength = buf.indexOf(Buffer.from(`${max}\n`), 2) + `${max}\n`.length;
  return { width, height, data: new Uint8Array(buf.subarray(headerLength, headerLength + width * height)) };
}

const here = path.dirname(fileURLToPath(import.meta.url));

describe("auto-capture probe on Sean's beige-table front (Oct 18)", () => {
  // 274x256-style probe: wider than tall, as expo-camera returns it with the phone flat.
  const img = readPgm(path.join(here, "testdata", "beige-clean-probe-256.pgm"));

  it("is wider than tall, like the probes in Sean's logs", () => {
    expect(img.width).toBeGreaterThan(img.height);
  });

  it("finds the card's corners even when the measured frame fill is ~10% off", () => {
    for (const fill of [0.86, 0.95]) {
      const detail = gradeProbeDetail(img, fill);
      expect(detail.blurry).toBe(false);
      expect(detail.corners).toBeGreaterThanOrEqual(3);
    }
  });
});
