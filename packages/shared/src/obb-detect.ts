export interface RgbBitmap {
  width: number;
  height: number;
  /** Packed RGB, length width × height × 3. */
  data: Uint8Array;
}

/** YOLO11 Nano OBB letterbox size. Server-side ONNX is the v1 runtime. */
export const YOLO11_OBB_INPUT = 640;

export interface ObbBox {
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Radians, YOLO OBB convention. */
  angle: number;
  score: number;
}

export interface ObbDetector {
  detect(image: RgbBitmap): Promise<ObbBox[]>;
}

export interface LetterboxMeta {
  scale: number;
  padX: number;
  padY: number;
  originalWidth: number;
  originalHeight: number;
}

export function sampleRgb(
  image: RgbBitmap,
  x: number,
  y: number,
  channel: number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const sx0 = Math.max(0, Math.min(image.width - 1, x0));
  const sy0 = Math.max(0, Math.min(image.height - 1, y0));
  const tx = x - x0;
  const ty = y - y0;
  const idx = (row: number, col: number) => (row * image.width + col) * 3 + channel;
  const top =
    image.data[idx(sy0, sx0)]! * (1 - tx) + image.data[idx(sy0, x1)]! * tx;
  const bottom =
    image.data[idx(y1, sx0)]! * (1 - tx) + image.data[idx(y1, x1)]! * tx;
  return top * (1 - ty) + bottom * ty;
}

export function resizeRgb(image: RgbBitmap, width: number, height: number): RgbBitmap {
  const data = new Uint8Array(width * height * 3);
  const xScale = image.width / width;
  const yScale = image.height / height;
  for (let y = 0; y < height; y++) {
    const srcY = (y + 0.5) * yScale - 0.5;
    for (let x = 0; x < width; x++) {
      const srcX = (x + 0.5) * xScale - 0.5;
      const out = (y * width + x) * 3;
      data[out] = sampleRgb(image, srcX, srcY, 0);
      data[out + 1] = sampleRgb(image, srcX, srcY, 1);
      data[out + 2] = sampleRgb(image, srcX, srcY, 2);
    }
  }
  return { width, height, data };
}

/** Axis-aligned full-frame box — CI fixture stills are already card crops. */
export function fullFrameObb(image: RgbBitmap, score = 1): ObbBox {
  return {
    cx: image.width / 2,
    cy: image.height / 2,
    width: image.width,
    height: image.height,
    angle: 0,
    score,
  };
}

export const fullFrameObbDetector: ObbDetector = {
  async detect(image) {
    return [fullFrameObb(image)];
  },
};

export const noCardObbDetector: ObbDetector = {
  async detect() {
    return [];
  },
};

/** Phone crop max edge; YOLO AABB crops match that so warp.py sees the same scale. */
export const LIVE_WARP_CROP_MAX_EDGE = 448;
const LIVE_WARP_CROP_INSET = 0.04;

/** TL, TR, BR, BL of an OBB in image pixels. */
export function obbCornersTlTrBrBl(box: ObbBox): { x: number; y: number }[] {
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const hw = Math.abs(box.width) / 2;
  const hh = Math.abs(box.height) / 2;
  const local: Array<[number, number]> = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  return local.map(([dx, dy]) => ({
    x: box.cx + dx * cos - dy * sin,
    y: box.cy + dx * sin + dy * cos,
  }));
}

export function obbQuadTlTrBrBl(box: ObbBox): number[] {
  return obbCornersTlTrBrBl(box).flatMap((point) => [point.x, point.y]);
}

/** Axis-aligned crop around the OBB (4% inset, like the phone crop) so warp.py can straighten. */
export function axisAlignedInsetCrop(
  box: ObbBox,
  imageWidth: number,
  imageHeight: number,
  inset = LIVE_WARP_CROP_INSET,
): { x: number; y: number; width: number; height: number } | null {
  const corners = obbCornersTlTrBrBl(box);
  let x0 = Math.min(...corners.map((corner) => corner.x));
  let y0 = Math.min(...corners.map((corner) => corner.y));
  let x1 = Math.max(...corners.map((corner) => corner.x));
  let y1 = Math.max(...corners.map((corner) => corner.y));
  const padX = (x1 - x0) * inset;
  const padY = (y1 - y0) * inset;
  x0 = Math.max(0, x0 + padX);
  y0 = Math.max(0, y0 + padY);
  x1 = Math.min(imageWidth, x1 - padX);
  y1 = Math.min(imageHeight, y1 - padY);
  const width = x1 - x0;
  const height = y1 - y0;
  if (width < 8 || height < 8) return null;
  return { x: x0, y: y0, width, height };
}

export function cropRgbRect(
  image: RgbBitmap,
  rect: { x: number; y: number; width: number; height: number },
): RgbBitmap {
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const left = Math.round(rect.x);
  const top = Math.round(rect.y);
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = Math.max(0, Math.min(image.width - 1, left + x));
      const srcY = Math.max(0, Math.min(image.height - 1, top + y));
      const src = (srcY * image.width + srcX) * 3;
      const dst = (y * width + x) * 3;
      data[dst] = image.data[src] ?? 0;
      data[dst + 1] = image.data[src + 1] ?? 0;
      data[dst + 2] = image.data[src + 2] ?? 0;
    }
  }
  return { width, height, data };
}

export function mapQuadIntoCrop(
  quad: readonly number[],
  crop: { x: number; y: number; width: number; height: number },
  outWidth: number,
  outHeight: number,
): number[] {
  const scaleX = crop.width > 0 ? outWidth / crop.width : 1;
  const scaleY = crop.height > 0 ? outHeight / crop.height : 1;
  const mapped: number[] = [];
  for (let i = 0; i < 8; i += 2) {
    mapped.push(((quad[i] ?? 0) - crop.x) * scaleX);
    mapped.push(((quad[i + 1] ?? 0) - crop.y) * scaleY);
  }
  return mapped;
}

/**
 * Axis-aligned detector crop plus the 4 OBB corners in that crop's pixels.
 * The sidecar runs `warp.py` on these corners before embedding.
 */
export function liveWarpCropFromObb(
  image: RgbBitmap,
  box: ObbBox,
  maxEdge = LIVE_WARP_CROP_MAX_EDGE,
): { crop: RgbBitmap; quad: number[] } | null {
  const bounds = axisAlignedInsetCrop(box, image.width, image.height);
  if (!bounds) return null;
  let crop = cropRgbRect(image, bounds);
  const scale = Math.min(1, maxEdge / Math.max(crop.width, crop.height));
  if (scale < 1) {
    crop = resizeRgb(
      crop,
      Math.max(8, Math.round(crop.width * scale)),
      Math.max(8, Math.round(crop.height * scale)),
    );
  }
  return {
    crop,
    quad: mapQuadIntoCrop(obbQuadTlTrBrBl(box), bounds, crop.width, crop.height),
  };
}

export function cropOrientedBox(image: RgbBitmap, box: ObbBox): RgbBitmap {
  const width = Math.max(1, Math.round(Math.abs(box.width)));
  const height = Math.max(1, Math.round(Math.abs(box.height)));
  const data = new Uint8Array(width * height * 3);
  if (box.angle === 0) {
    const left = Math.round(box.cx - width / 2);
    const top = Math.round(box.cy - height / 2);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcX = Math.max(0, Math.min(image.width - 1, left + x));
        const srcY = Math.max(0, Math.min(image.height - 1, top + y));
        const src = (srcY * image.width + srcX) * 3;
        const dst = (y * width + x) * 3;
        data[dst] = image.data[src] ?? 0;
        data[dst + 1] = image.data[src + 1] ?? 0;
        data[dst + 2] = image.data[src + 2] ?? 0;
      }
    }
    return { width, height, data };
  }
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const halfW = width / 2;
  const halfH = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - halfW;
      const dy = y + 0.5 - halfH;
      const srcX = box.cx + dx * cos - dy * sin;
      const srcY = box.cy + dx * sin + dy * cos;
      const out = (y * width + x) * 3;
      data[out] = sampleRgb(image, srcX, srcY, 0);
      data[out + 1] = sampleRgb(image, srcX, srcY, 1);
      data[out + 2] = sampleRgb(image, srcX, srcY, 2);
    }
  }
  return { width, height, data };
}

export function bestObbBox(boxes: ObbBox[]): ObbBox | null {
  let best: ObbBox | null = null;
  for (const box of boxes) {
    if (!best || box.score > best.score) best = box;
  }
  return best;
}

export function letterboxToYoloInput(image: RgbBitmap): {
  chw: Float32Array;
  meta: LetterboxMeta;
} {
  const maxSide = Math.max(image.width, image.height);
  const scale = YOLO11_OBB_INPUT / maxSide;
  const resizedW = Math.max(1, Math.round(image.width * scale));
  const resizedH = Math.max(1, Math.round(image.height * scale));
  const padX = Math.floor((YOLO11_OBB_INPUT - resizedW) / 2);
  const padY = Math.floor((YOLO11_OBB_INPUT - resizedH) / 2);
  const resized = resizeRgb(image, resizedW, resizedH);
  const chw = new Float32Array(3 * YOLO11_OBB_INPUT * YOLO11_OBB_INPUT);
  // Ultralytics LetterBox pad (114/255), not black — ONNX crops match training.
  chw.fill(114 / 255);
  const plane = YOLO11_OBB_INPUT * YOLO11_OBB_INPUT;
  for (let y = 0; y < resizedH; y++) {
    for (let x = 0; x < resizedW; x++) {
      const src = (y * resizedW + x) * 3;
      const dst = (padY + y) * YOLO11_OBB_INPUT + (padX + x);
      chw[dst] = resized.data[src]! / 255;
      chw[plane + dst] = resized.data[src + 1]! / 255;
      chw[plane * 2 + dst] = resized.data[src + 2]! / 255;
    }
  }
  return {
    chw,
    meta: {
      scale,
      padX,
      padY,
      originalWidth: image.width,
      originalHeight: image.height,
    },
  };
}

export function mapYoloObbToImage(box: ObbBox, meta: LetterboxMeta): ObbBox {
  return {
    cx: (box.cx - meta.padX) / meta.scale,
    cy: (box.cy - meta.padY) / meta.scale,
    width: box.width / meta.scale,
    height: box.height / meta.scale,
    angle: box.angle,
    score: box.score,
  };
}

/**
 * YOLO11 OBB channels-first tensor: [x, y, w, h, class scores..., angle] × preds.
 * Coordinates are in the 640 letterbox.
 */
export function yolo11ObbBoxesFromChannelsFirst(
  data: Float32Array,
  channels: number,
  preds: number,
  options: { numClass?: number; scoreThreshold?: number } = {},
): ObbBox[] {
  const numClass = options.numClass ?? 1;
  const scoreThreshold = options.scoreThreshold ?? 0.1;
  const angleChannel = 4 + numClass;
  const boxes: ObbBox[] = [];
  if (channels < angleChannel + 1 || preds <= 0) return boxes;
  for (let i = 0; i < preds; i++) {
    let score = 0;
    for (let c = 0; c < numClass; c++) {
      const classScore = data[(4 + c) * preds + i] ?? 0;
      if (classScore > score) score = classScore;
    }
    if (score < scoreThreshold) continue;
    boxes.push({
      cx: data[i] ?? 0,
      cy: data[preds + i] ?? 0,
      width: data[2 * preds + i] ?? 0,
      height: data[3 * preds + i] ?? 0,
      angle: data[angleChannel * preds + i] ?? 0,
      score,
    });
  }
  return nmsObb(boxes);
}

function aabbIou(a: ObbBox, b: ObbBox): number {
  const a1 = a.cx - a.width / 2;
  const a2 = a.cx + a.width / 2;
  const a3 = a.cy - a.height / 2;
  const a4 = a.cy + a.height / 2;
  const b1 = b.cx - b.width / 2;
  const b2 = b.cx + b.width / 2;
  const b3 = b.cy - b.height / 2;
  const b4 = b.cy + b.height / 2;
  const left = Math.max(a1, b1);
  const right = Math.min(a2, b2);
  const top = Math.max(a3, b3);
  const bottom = Math.min(a4, b4);
  const inter = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

export function nmsObb(boxes: ObbBox[], iouThreshold = 0.5): ObbBox[] {
  const ranked = [...boxes].sort((left, right) => right.score - left.score);
  const kept: ObbBox[] = [];
  for (const box of ranked) {
    if (kept.some((existing) => aabbIou(existing, box) > iouThreshold)) continue;
    kept.push(box);
  }
  return kept;
}

export interface Yolo11ObbInference {
  infer(chw: Float32Array): Promise<Float32Array> | Float32Array;
  outputChannels: number;
  outputPreds: number;
  numClass?: number;
}

export interface Yolo11ObbTensorLayout {
  channels: number;
  preds: number;
  transpose: boolean;
}

/**
 * YOLO11 OBB ONNX is usually `[1, channels, preds]` (channels-first).
 * Some exports are `[1, preds, channels]` and need a transpose.
 */
export function yolo11ObbLayoutFromDims(dims: readonly number[]): Yolo11ObbTensorLayout {
  if (dims.length === 3 && dims[0] === 1) {
    const mid = dims[1] ?? 0;
    const last = dims[2] ?? 0;
    if (last <= 32 && mid > 32) return { channels: last, preds: mid, transpose: true };
    return { channels: mid, preds: last, transpose: false };
  }
  if (dims.length !== 2) {
    return { channels: dims[0] ?? 0, preds: dims[1] ?? 0, transpose: false };
  }
  const [first, second] = dims as [number, number];
  if (second <= 32 && first > 32) return { channels: second, preds: first, transpose: true };
  return { channels: first, preds: second, transpose: false };
}

export function yolo11ObbChannelsFirstFromOnnx(
  data: Float32Array,
  dims: readonly number[],
): { data: Float32Array; channels: number; preds: number } {
  const layout = yolo11ObbLayoutFromDims(dims);
  if (!layout.transpose) return { data, channels: layout.channels, preds: layout.preds };
  const out = new Float32Array(layout.channels * layout.preds);
  for (let pred = 0; pred < layout.preds; pred++) {
    for (let channel = 0; channel < layout.channels; channel++) {
      out[channel * layout.preds + pred] = data[pred * layout.channels + channel] ?? 0;
    }
  }
  return { data: out, channels: layout.channels, preds: layout.preds };
}

export function createYolo11ObbInferenceFromTensor(options: {
  data: Float32Array;
  dims: readonly number[];
  numClass?: number;
}): Yolo11ObbInference {
  const layout = yolo11ObbChannelsFirstFromOnnx(options.data, options.dims);
  return {
    outputChannels: layout.channels,
    outputPreds: layout.preds,
    numClass: options.numClass,
    infer() {
      return layout.data;
    },
  };
}

/**
 * YOLO11 Nano OBB detector. Missing weights → full-frame crop so CI fixture
 * stills (already cropped) still hash. ONNX inference is injected when present.
 */
export function createYolo11NanoObbDetector(
  inference?: Yolo11ObbInference,
): ObbDetector {
  if (!inference) return fullFrameObbDetector;
  return {
    async detect(image) {
      const { chw, meta } = letterboxToYoloInput(image);
      const raw = await inference.infer(chw);
      const letterboxed = yolo11ObbBoxesFromChannelsFirst(
        raw,
        inference.outputChannels,
        inference.outputPreds,
        { numClass: inference.numClass },
      );
      return letterboxed.map((box) => mapYoloObbToImage(box, meta));
    },
  };
}
