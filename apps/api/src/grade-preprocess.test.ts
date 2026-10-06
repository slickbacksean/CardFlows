// Reconstructed 2026-10-05 after the original was removed by mistake during the
// P1 grader swap. Same cases as the original call sites: no card, full-frame
// stub, undecodable still, real OBB crop.
import { describe, expect, it } from "vitest";
import {
  createYolo11NanoObbDetector,
  noCardObbDetector,
  type ObbDetector,
} from "@cardflow/shared";
import { encodePngStill } from "./obb-phash-decode";
import { preprocessGradeStill } from "./grade-preprocess";

function solidBitmap(width: number, height: number) {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    data[i * 3] = 200;
    data[i * 3 + 1] = 10;
    data[i * 3 + 2] = 10;
  }
  return { width, height, data };
}

describe("grade preprocess", () => {
  it("keeps the original still when there is no card or only the full-frame stub", async () => {
    const original = { bytes: encodePngStill(solidBitmap(20, 30)), mimeType: "image/png" as const };
    const noCard = await preprocessGradeStill(original, noCardObbDetector);
    expect(noCard.usedObbCrop).toBe(false);
    expect(noCard.bytes).toBe(original.bytes);

    const fullFrame = await preprocessGradeStill(original, createYolo11NanoObbDetector());
    expect(fullFrame.usedObbCrop).toBe(false);
    expect(fullFrame.bytes).toBe(original.bytes);
  });

  it("does not crop an undecodable still", async () => {
    const tinyJpeg = { bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), mimeType: "image/jpeg" as const };
    const undecodable = await preprocessGradeStill(tinyJpeg);
    expect(undecodable.usedObbCrop).toBe(false);
    expect(undecodable.bytes).toBe(tinyJpeg.bytes);
  });

  it("returns a PNG crop when the detector finds a real box", async () => {
    const png = encodePngStill(solidBitmap(20, 30));
    const detector: ObbDetector = {
      async detect() {
        return [{ cx: 10, cy: 15, width: 8, height: 12, angle: 0.2, score: 0.9 }];
      },
    };
    const cropped = await preprocessGradeStill({ bytes: png, mimeType: "image/png" }, detector);
    expect(cropped.usedObbCrop).toBe(true);
    expect(cropped.mimeType).toBe("image/png");
    expect(cropped.bytes).not.toEqual(png);
  });
});
