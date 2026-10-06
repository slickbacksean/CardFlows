import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ciStillBitmap,
  createYolo11ObbInferenceFromTensor,
  YOLO11_OBB_INPUT,
  type RgbBitmap,
} from "@cardflow/shared";
import { encodePngStill } from "./obb-phash-decode";
import { preprocessGradeStill } from "./grade-preprocess";
import {
  createObbDetectorFromEnv,
  createOnnxYolo11ObbInference,
  resolveObbOnnxPath,
} from "./obb-onnx";

const apiRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const localOnnx = path.join(apiRoot, "models/yolo11n-obb.onnx");

function messyPhysicalCardStill(): RgbBitmap {
  const width = 320;
  const height = 240;
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      data[i] = 96 + (x % 19);
      data[i + 1] = 64 + (y % 11);
      data[i + 2] = 32 + ((x + y) % 9);
    }
  }
  const cardW = 96;
  const cardH = 134;
  const left = 36;
  const top = 48;
  for (let y = 0; y < cardH; y++) {
    for (let x = 0; x < cardW; x++) {
      const i = ((top + y) * width + (left + x)) * 3;
      const border = x < 7 || y < 7 || x >= cardW - 7 || y >= cardH - 7;
      if (border) {
        data[i] = 238;
        data[i + 1] = 210;
        data[i + 2] = 42;
        continue;
      }
      const art = y < 78;
      data[i] = art ? 36 : 236;
      data[i + 1] = art ? 92 : 236;
      data[i + 2] = art ? 168 : 228;
    }
  }
  return { width, height, data };
}

describe("Capture YOLO11 OBB ONNX wiring", () => {
  it("stays on the full-frame stub without AGPL or a weights path", async () => {
    const image = ciStillBitmap("base1-58");
    const stub = createObbDetectorFromEnv({
      CARD_FLOW_OBB_ONNX_PATH: "/tmp/missing-yolo11n-obb.onnx",
    });
    const boxes = await stub.detect(image);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.width).toBe(image.width);
    expect(boxes[0]?.height).toBe(image.height);
  });

  it("does not load weights when AGPL is not accepted even if a path is set", async () => {
    const image = ciStillBitmap("base1-58");
    const detector = createObbDetectorFromEnv(
      { CARD_FLOW_OBB_ONNX_PATH: localOnnx },
      {
        async loadSession() {
          throw new Error("must not load onnx without AGPL");
        },
      },
    );
    const boxes = await detector.detect(image);
    expect(boxes[0]?.width).toBe(image.width);
    expect(boxes[0]?.height).toBe(image.height);
  });

  it("uses injected ONNX output when AGPL is accepted", async () => {
    const image = ciStillBitmap("base1-58");
    const preds = 1;
    const channels = 6;
    const data = new Float32Array(channels * preds);
    data[0] = 320;
    data[preds] = YOLO11_OBB_INPUT / 2;
    data[2 * preds] = 480;
    data[3 * preds] = YOLO11_OBB_INPUT;
    data[4 * preds] = 0.95;
    const inference = createYolo11ObbInferenceFromTensor({
      data,
      dims: [1, channels, preds],
    });
    const detector = createObbDetectorFromEnv(
      {
        CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED: "true",
        CARD_FLOW_OBB_ONNX_PATH: "/tmp/fake-yolo11n-obb.onnx",
      },
      { inference },
    );
    const boxes = await detector.detect(image);
    expect(boxes[0]?.score).toBeCloseTo(0.95);
    expect(boxes[0]?.cx).toBeCloseTo(image.width / 2, 0);
  });

  it("does not load a missing gitignored onnx file even with AGPL accepted", async () => {
    expect(resolveObbOnnxPath("/tmp/cardflow-missing-yolo11n-obb.onnx")).toBeUndefined();
    const inference = await createOnnxYolo11ObbInference({
      path: "/tmp/cardflow-missing-yolo11n-obb.onnx",
      async loadSession() {
        throw new Error("should not load");
      },
    });
    expect(inference).toBeUndefined();
  });

  it.skipIf(!existsSync(localOnnx))(
    "returns a tighter crop than the full still on a messy photo when local weights exist",
    async () => {
      const probe = path.join(apiRoot, ".obb-train/messy-still.jpg");
      const still = existsSync(probe)
        ? { bytes: new Uint8Array(readFileSync(probe)), mimeType: "image/jpeg" as const }
        : { bytes: encodePngStill(messyPhysicalCardStill()), mimeType: "image/png" as const };
      const detector = createObbDetectorFromEnv({
        CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED: "true",
        CARD_FLOW_OBB_ONNX_PATH: localOnnx,
      });
      const cropped = await preprocessGradeStill(still, detector);
      expect(cropped.usedObbCrop).toBe(true);
      expect(cropped.bytes.byteLength).toBeGreaterThan(0);
      expect(cropped.bytes).not.toEqual(still.bytes);
    },
    20_000,
  );
});
