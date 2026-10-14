/**
 * Livestream card box from the gitignored YOLO11 OBB weights.
 * Loaded only after CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true.
 * The input is a live-video frame, never a page still.
 */
import jpeg from "jpeg-js";
import {
  bestObbBox,
  createYolo11NanoObbDetector,
  liveWarpCropFromObb,
  rgbPerceptualHash,
  type ObbDetector,
  type RgbBitmap,
} from "@cardflow/shared";
import { decodeScanStill } from "./obb-phash-decode";
import { resolveObbInferenceFromEnv } from "./obb-onnx";

const MIN_SCORE = 0.25;
const MIN_FILL = 0.015;
const MAX_FILL = 0.72;

export async function resolveLiveVideoObbDetector(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ObbDetector | null> {
  const inference = await resolveObbInferenceFromEnv(env);
  if (!inference) return null;
  return createYolo11NanoObbDetector(inference);
}

export type LiveVideoLocateResult =
  | { found: false }
  | { found: true; jpegBase64: string; identityHash: string; identityCropQuad: number[] };

/** null when the frame cannot be decoded. `found: false` when YOLO sees no card. */
export async function locateLiveVideoCard(
  detector: ObbDetector,
  jpegBase64: string,
): Promise<LiveVideoLocateResult | null> {
  const bytes = decodeBase64(jpegBase64);
  if (!bytes) return null;
  const image = await decodeScanStill(bytes, "image/jpeg");
  if (!image || image.width < 16 || image.height < 16) return null;
  let boxes;
  try {
    boxes = await detector.detect(image);
  } catch {
    return null;
  }
  const box = bestObbBox(boxes.filter((candidate) => candidate.score >= MIN_SCORE));
  if (!box || box.width < 8 || box.height < 8) return { found: false };
  const fill = (Math.abs(box.width) * Math.abs(box.height)) / (image.width * image.height);
  if (fill < MIN_FILL || fill > MAX_FILL) return { found: false };
  const warped = liveWarpCropFromObb(image, box);
  if (!warped || warped.crop.width < 8 || warped.crop.height < 8) return { found: false };
  return {
    found: true,
    jpegBase64: Buffer.from(encodeRgbJpeg(warped.crop)).toString("base64"),
    identityHash: rgbPerceptualHash(warped.crop),
    identityCropQuad: warped.quad.map((value) => Math.round(value * 100) / 100),
  };
}

function decodeBase64(raw: string): Uint8Array | null {
  const trimmed = raw.trim();
  const dataUrl = /^data:image\/jpe?g;base64,(.+)$/i.exec(trimmed);
  const b64 = dataUrl?.[1] ?? trimmed;
  if (b64.length < 32 || b64.length > 900_000) return null;
  try {
    const binary = Buffer.from(b64, "base64");
    if (binary.byteLength < 32) return null;
    return new Uint8Array(binary);
  } catch {
    return null;
  }
}

function encodeRgbJpeg(bitmap: RgbBitmap): Uint8Array {
  const rgba = new Uint8Array(bitmap.width * bitmap.height * 4);
  for (let i = 0; i < bitmap.width * bitmap.height; i++) {
    rgba[i * 4] = bitmap.data[i * 3] ?? 0;
    rgba[i * 4 + 1] = bitmap.data[i * 3 + 1] ?? 0;
    rgba[i * 4 + 2] = bitmap.data[i * 3 + 2] ?? 0;
    rgba[i * 4 + 3] = 255;
  }
  const encoded = jpeg.encode({ data: rgba, width: bitmap.width, height: bitmap.height }, 80);
  return encoded.data;
}
