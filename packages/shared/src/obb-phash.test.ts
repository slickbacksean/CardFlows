import { describe, expect, it } from "vitest";
import {
  cropOrientedBox,
  createYolo11NanoObbDetector,
  fullFrameObb,
  letterboxToYoloInput,
  noCardObbDetector,
  yolo11ObbBoxesFromChannelsFirst,
  yolo11ObbLayoutFromDims,
  YOLO11_OBB_INPUT,
} from "./obb-detect";
import {
  ciPhashIndex,
  ciStillBitmap,
  composeMessyCiCardStill,
  createObbPhashRecognitionProvider,
  fullFrameObbDetector,
  hammingDistance,
  identifyObbPhashBitmap,
  matchRgbPhash,
  parsePhashIndex,
  rgbPerceptualHash,
  RGB_PHASH_BITS,
} from "./obb-phash";
import fixtureIndex from "../fixtures/obb-phash-index.json";

describe("RGB pHash still identify", () => {
  it("hashes a fixture still of base1-58 as that tcgdex_id without CardSight", async () => {
    const still = ciStillBitmap("base1-58");
    const hash = rgbPerceptualHash(still);
    expect(hash).toHaveLength(RGB_PHASH_BITS);
    expect(hash).toMatch(/^[01]+$/);
    expect(hammingDistance(hash, hash)).toBe(0);

    const result = await identifyObbPhashBitmap(still);
    expect(result.provider).toBe("obb_phash");
    expect(result.ok).toBe(true);
    expect(result.detections[0]?.vendorCardId).toBe("base1-58");
    expect(result.detections[0]?.confidence).toBe("High");
    expect(result.detections[0]?.candidates[0]?.fields).toEqual(
      expect.arrayContaining([{ key: "tcgdex_id", value: "base1-58" }]),
    );
    expect(JSON.stringify(result)).not.toMatch(/api[_ -]?key/i);
    expect(JSON.stringify(result)).not.toMatch(/cardsight\.ai/i);
    expect(JSON.stringify(result)).not.toMatch(/A1_\d+_EN|tcg-pocket|P-A\.json/i);
  });

  it("ranks a second CI still as base1-4 and never invents an id", async () => {
    const result = await identifyObbPhashBitmap(ciStillBitmap("base1-4"));
    expect(result.detections[0]?.vendorCardId).toBe("base1-4");
    expect(result.detections[0]?.candidates.map((item) => item.vendorCardId)).not.toContain(
      "not-a-real-id",
    );

    const unmatched = await identifyObbPhashBitmap({
      width: 32,
      height: 32,
      data: new Uint8Array(32 * 32 * 3),
    });
    expect(unmatched.detections).toEqual([]);
    expect(unmatched.provider).toBe("obb_phash");
  });

  it("skips Pocket-shaped or invalid index ids", () => {
    const index = parsePhashIndex({
      language: "en",
      entries: [
        { tcgdexId: "A1-001", hash: "1".repeat(RGB_PHASH_BITS) },
        { tcgdexId: "B1-001", hash: "1".repeat(RGB_PHASH_BITS) },
        { tcgdex_id: "not a card", hash: "1".repeat(RGB_PHASH_BITS) },
        { tcgdexId: "base1-58", hash: rgbPerceptualHash(ciStillBitmap("base1-58")) },
      ],
    });
    expect(index.entries.map((entry) => entry.tcgdexId)).toEqual(["base1-58"]);
    const matches = matchRgbPhash(rgbPerceptualHash(ciStillBitmap("base1-58")), index);
    expect(matches.map((match) => match.tcgdexId)).toEqual(["base1-58"]);
  });

  it("uses a tiny fixture index of English tcgdex_ids, not Pocket art", () => {
    const fixture = fixtureIndex as { _meta?: { mocked?: boolean }; entries: Array<{ tcgdexId: string }> };
    expect(fixture._meta?.mocked).toBe(true);
    expect(fixture.entries.map((entry) => entry.tcgdexId).sort()).toEqual(["base1-4", "base1-58"]);
    expect(ciPhashIndex().entries.map((entry) => entry.tcgdexId).sort()).toEqual([
      "base1-4",
      "base1-58",
    ]);
    expect(JSON.stringify(fixture)).not.toMatch(/A1_\d+_EN|tcg-pocket|P-A\.json/i);
  });
});

describe("YOLO11 Nano OBB crop", () => {
  it("crops the best OBB before hashing", async () => {
    const card = ciStillBitmap("base1-58");
    const canvas = {
      width: 96,
      height: 96,
      data: new Uint8Array(96 * 96 * 3),
    };
    for (let y = 0; y < card.height; y++) {
      for (let x = 0; x < card.width; x++) {
        const src = (y * card.width + x) * 3;
        const dst = ((y + 16) * 96 + (x + 24)) * 3;
        canvas.data[dst] = card.data[src]!;
        canvas.data[dst + 1] = card.data[src + 1]!;
        canvas.data[dst + 2] = card.data[src + 2]!;
      }
    }
    const box = { cx: 24 + 24, cy: 16 + 32, width: 48, height: 64, angle: 0, score: 0.9 };
    const crop = cropOrientedBox(canvas, box);
    expect(crop.width).toBe(48);
    expect(crop.height).toBe(64);
    const result = await identifyObbPhashBitmap(canvas, {
      detector: { async detect() { return [box]; } },
    });
    expect(result.detections[0]?.vendorCardId).toBe("base1-58");
  });

  it("names an off-center rotated still after OBB crop and stays empty on the full-frame stub", async () => {
    const messy = composeMessyCiCardStill("base1-58");
    const crop = cropOrientedBox(messy.bitmap, messy.box);
    expect(crop.width).toBe(180);
    expect(crop.height).toBe(240);

    const stub = await identifyObbPhashBitmap(messy.bitmap, { detector: fullFrameObbDetector });
    expect(stub.ok).toBe(true);
    expect(stub.detections).toEqual([]);

    const cropped = await identifyObbPhashBitmap(messy.bitmap, {
      detector: { async detect() { return [messy.box]; } },
    });
    expect(cropped.provider).toBe("obb_phash");
    expect(cropped.detections[0]?.vendorCardId).toBe("base1-58");
    expect(cropped.detections[0]?.candidates[0]?.fields).toEqual(
      expect.arrayContaining([{ key: "tcgdex_id", value: "base1-58" }]),
    );
    expect(JSON.stringify(cropped)).not.toMatch(/cardsight\.ai|A1_\d+_EN|tcg-pocket/i);
  });

  it("returns no detections when YOLO finds no card", async () => {
    const result = await identifyObbPhashBitmap(ciStillBitmap("base1-58"), {
      detector: noCardObbDetector,
    });
    expect(result.ok).toBe(true);
    expect(result.detections).toEqual([]);
  });

  it("parses a YOLO11 OBB tensor and maps it out of the 640 letterbox", async () => {
    const image = ciStillBitmap("base1-58");
    const { chw, meta } = letterboxToYoloInput(image);
    expect(meta.originalWidth).toBe(48);
    expect(chw[0]).toBeCloseTo(114 / 255);
    const preds = 2;
    const channels = 6;
    const data = new Float32Array(channels * preds);
    data[0] = 320;
    data[preds] = YOLO11_OBB_INPUT / 2;
    data[2 * preds] = 480;
    data[3 * preds] = YOLO11_OBB_INPUT;
    data[4 * preds] = 0.92;
    data[5 * preds] = 0;
    const boxes = yolo11ObbBoxesFromChannelsFirst(data, channels, preds);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.score).toBeCloseTo(0.92);
    expect(yolo11ObbLayoutFromDims([1, 6, 8400])).toEqual({
      channels: 6,
      preds: 8400,
      transpose: false,
    });
    expect(yolo11ObbLayoutFromDims([1, 8400, 6])).toEqual({
      channels: 6,
      preds: 8400,
      transpose: true,
    });

    const detector = createYolo11NanoObbDetector({
      outputChannels: channels,
      outputPreds: preds,
      infer: () => data,
    });
    const mapped = await detector.detect(image);
    expect(mapped[0]?.cx).toBeCloseTo(image.width / 2, 0);
    expect(mapped[0]?.width).toBeCloseTo(image.width, 0);
    expect(fullFrameObb(image).width).toBe(image.width);
  });
});

describe("obb_phash CardRecognitionProvider", () => {
  it("ignores mock scenarios and reads decoded still bytes", async () => {
    const still = ciStillBitmap("base1-58");
    const provider = createObbPhashRecognitionProvider({
      async decode(image) {
        expect(image.byteLength).toBeGreaterThan(0);
        return still;
      },
    });
    expect(provider.name).toBe("obb_phash");
    const result = await provider.identifyCard({
      image: new Uint8Array([1, 2, 3]),
      mimeType: "image/jpeg",
      scenario: "ambiguous",
    });
    expect(result.provider).toBe("obb_phash");
    expect(result.detections[0]?.vendorCardId).toBe("base1-58");
    expect(result.detections[0]?.name).toBeNull();
  });
});
