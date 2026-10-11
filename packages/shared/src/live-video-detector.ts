import {
  YOLO26N_LICENSE_SHIP_TODO,
  yolo26nOnDeviceAllowed,
  type Yolo26nOnDeviceGateInput,
} from "./ultralytics-license";

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
