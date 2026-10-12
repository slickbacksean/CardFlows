import type { CardCorners, CardQuad } from "./card-quad";
import {
  YOLO26N_LICENSE_SHIP_TODO,
  yolo26nOnDeviceAllowed,
  type Yolo26nOnDeviceGateInput,
} from "./ultralytics-license";

export const YOLO26N_CARD_QUAD_SOURCE = "yolo26n-ab" as const;
export const YOLO26N_CARD_QUAD_VERSION = "yolo26n-ab@pre-ship" as const;
export const YOLO26N_CARD_QUAD_MIN_CONF = 0.25;

/** Native card-detect backends on the livestream sample-buffer path. */
export const LIVE_VIDEO_DETECTOR_BACKENDS = ["rectangle", "yolo26n"] as const;
export type LiveVideoDetectorBackend = (typeof LIVE_VIDEO_DETECTOR_BACKENDS)[number];

/**
 * `rectangle` — Vision / Sobel fallback only.
 * `yolo26n` — YOLO26n when gated on; rectangle if the model is missing.
 * `ab` — run both, crop from YOLO when it hits, else rectangle; attach comparison.
 */
export const LIVE_VIDEO_DETECTOR_MODES = ["rectangle", "yolo26n", "ab"] as const;
export type LiveVideoDetectorMode = (typeof LIVE_VIDEO_DETECTOR_MODES)[number];

/** Which crop actually went to OpenCLIP / pHash. */
export const LIVE_VIDEO_CROP_SOURCES = [
  "yolo26n",
  "rectangle",
  "fallback_rectangle",
] as const;
export type LiveVideoCropSource = (typeof LIVE_VIDEO_CROP_SOURCES)[number];

export const LIVE_VIDEO_DETECTOR_IOU_AGREE = 0.5;

/** Normalized image box, origin bottom-left on iOS Vision / top-left on Android. */
export interface LiveVideoDetectorBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
}

export interface LiveVideoDetectorObservation {
  backend: LiveVideoDetectorBackend;
  cardDetected: boolean;
  box: LiveVideoDetectorBox | null;
  latencyMs: number;
}

export interface LiveVideoDetectorAbSample {
  yolo: LiveVideoDetectorObservation;
  rectangle: LiveVideoDetectorObservation;
  iou: number | null;
  agreement: boolean;
  cropSource: LiveVideoCropSource;
}

export interface LiveVideoDetectorAbSummary {
  frames: number;
  yoloDetections: number;
  rectangleDetections: number;
  bothDetected: number;
  agreed: number;
  meanIouWhenBoth: number | null;
  meanYoloLatencyMs: number | null;
  meanRectangleLatencyMs: number | null;
}

export interface LiveVideoDetectorConfig {
  mode: LiveVideoDetectorMode;
  yoloEnabled: boolean;
  licenseTodo: typeof YOLO26N_LICENSE_SHIP_TODO;
}

export function isLiveVideoDetectorMode(value: string | null | undefined): value is LiveVideoDetectorMode {
  return (LIVE_VIDEO_DETECTOR_MODES as readonly string[]).includes(value ?? "");
}

export function normalizeLiveVideoDetectorMode(
  value: string | null | undefined,
): LiveVideoDetectorMode {
  return isLiveVideoDetectorMode(value) ? value : "rectangle";
}

export function resolveLiveVideoDetectorConfig(
  input: Yolo26nOnDeviceGateInput & { mode?: string | null } = {},
): LiveVideoDetectorConfig {
  const yoloEnabled = yolo26nOnDeviceAllowed(input);
  const explicit = input.mode ?? input.env?.CARD_FLOW_YOLO26N_MODE;
  if (!yoloEnabled) {
    return {
      mode: "rectangle",
      yoloEnabled: false,
      licenseTodo: YOLO26N_LICENSE_SHIP_TODO,
    };
  }
  return {
    mode: explicit ? normalizeLiveVideoDetectorMode(explicit) : "yolo26n",
    yoloEnabled: true,
    licenseTodo: YOLO26N_LICENSE_SHIP_TODO,
  };
}

export function boxIou(
  a: LiveVideoDetectorBox | null | undefined,
  b: LiveVideoDetectorBox | null | undefined,
): number | null {
  if (!a || !b) return null;
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return null;
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = ix2 - ix1;
  const ih = iy2 - iy1;
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const union = a.width * a.height + b.width * b.height - inter;
  if (union <= 0) return 0;
  return inter / union;
}

export function detectorsAgree(
  yolo: LiveVideoDetectorObservation,
  rectangle: LiveVideoDetectorObservation,
  minIou: number = LIVE_VIDEO_DETECTOR_IOU_AGREE,
): boolean {
  if (yolo.cardDetected !== rectangle.cardDetected) return false;
  if (!yolo.cardDetected) return true;
  const iou = boxIou(yolo.box, rectangle.box);
  return iou != null && iou >= minIou;
}

export function chooseLiveVideoCropSource(
  yolo: LiveVideoDetectorObservation,
  rectangle: LiveVideoDetectorObservation,
): LiveVideoCropSource {
  if (yolo.cardDetected) return "yolo26n";
  if (rectangle.cardDetected) return "fallback_rectangle";
  return "rectangle";
}

export function compareLiveVideoDetectors(
  yolo: LiveVideoDetectorObservation,
  rectangle: LiveVideoDetectorObservation,
  minIou: number = LIVE_VIDEO_DETECTOR_IOU_AGREE,
): LiveVideoDetectorAbSample {
  return {
    yolo,
    rectangle,
    iou: boxIou(yolo.box, rectangle.box),
    agreement: detectorsAgree(yolo, rectangle, minIou),
    cropSource: chooseLiveVideoCropSource(yolo, rectangle),
  };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function cardCornersFromAxisAlignedBox(
  box: LiveVideoDetectorBox,
  image: { width: number; height: number },
  origin: "top-left" | "bottom-left" = "top-left",
): CardCorners {
  const x1 = box.x * image.width;
  const width = box.width * image.width;
  const height = box.height * image.height;
  const y1 =
    origin === "bottom-left"
      ? (1 - box.y - box.height) * image.height
      : box.y * image.height;
  const x2 = x1 + width;
  const y2 = y1 + height;
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

/**
 * Shared card-finder outline for the test-only YOLO26n A/B baseline.
 * `source` is always `yolo26n-ab`. Returns null when there is no YOLO box.
 */
export function cardQuadFromYolo26n(input: {
  box: LiveVideoDetectorBox | null | undefined;
  imageWidth: number;
  imageHeight: number;
  origin?: "top-left" | "bottom-left";
  acceptThreshold?: number;
}): CardQuad | null {
  if (!input.box || input.imageWidth < 8 || input.imageHeight < 8) return null;
  if (input.box.width <= 0 || input.box.height <= 0) return null;
  const corners = cardCornersFromAxisAlignedBox(
    input.box,
    { width: input.imageWidth, height: input.imageHeight },
    input.origin ?? "top-left",
  );
  const confidence = input.box.confidence ?? 0;
  const threshold = input.acceptThreshold ?? YOLO26N_CARD_QUAD_MIN_CONF;
  const rejectReasons: string[] = [];
  const shortest = Math.min(input.box.width * input.imageWidth, input.box.height * input.imageHeight);
  const longest = Math.max(input.box.width * input.imageWidth, input.box.height * input.imageHeight);
  const ratio = longest > 0 ? shortest / longest : 0;
  if (ratio < 0.6 || ratio > 0.82) rejectReasons.push("aspect");
  const fill = input.box.width * input.box.height;
  if (fill < 0.1) rejectReasons.push("fill");
  if (confidence < threshold) rejectReasons.push("low_confidence");
  return {
    version: 1,
    source: YOLO26N_CARD_QUAD_SOURCE,
    sourceVersion: YOLO26N_CARD_QUAD_VERSION,
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    corners,
    confidence,
    accepted: rejectReasons.length === 0,
    outOfPlaneDeg: null,
    rejectReasons,
  };
}

/** A/B harness rollup for latency + detection agreement. */
export function summarizeLiveVideoDetectorAb(
  samples: readonly LiveVideoDetectorAbSample[],
): LiveVideoDetectorAbSummary {
  const both = samples.filter((sample) => sample.yolo.cardDetected && sample.rectangle.cardDetected);
  const ious = both.map((sample) => sample.iou).filter((value): value is number => value != null);
  return {
    frames: samples.length,
    yoloDetections: samples.filter((sample) => sample.yolo.cardDetected).length,
    rectangleDetections: samples.filter((sample) => sample.rectangle.cardDetected).length,
    bothDetected: both.length,
    agreed: samples.filter((sample) => sample.agreement).length,
    meanIouWhenBoth: mean(ious),
    meanYoloLatencyMs: mean(samples.map((sample) => sample.yolo.latencyMs)),
    meanRectangleLatencyMs: mean(samples.map((sample) => sample.rectangle.latencyMs)),
  };
}
