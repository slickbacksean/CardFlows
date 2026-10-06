import {
  bestObbBox,
  cropOrientedBox,
  createYolo11NanoObbDetector,
  fullFrameObbDetector,
  resizeRgb,
  sampleRgb,
  type ObbBox,
  type ObbDetector,
  type RgbBitmap,
} from "./obb-detect";
import { normalizeLiveVideoTcgdexId } from "./live-video-identity";
import type {
  CardFlowNormalizedRecognitionResult,
  RecognitionCandidate,
  RecognitionConfidence,
  RecognitionDetection,
} from "./types";
import type { CardRecognitionProvider, IdentifyCardRequest } from "./recognition";

/** Spatial size for the RGB DCT pHash (24×24, 3 channels → 105-bit hash). */
export const RGB_PHASH_SIZE = 24;
const RGB_PHASH_FREQ = Math.floor(RGB_PHASH_SIZE / 4);

export const RGB_PHASH_BITS = (RGB_PHASH_FREQ * RGB_PHASH_FREQ - 1) * 3;

export const PHASH_HIGH_MAX_DISTANCE = 8;
export const PHASH_MEDIUM_MAX_DISTANCE = 16;
export const PHASH_LOW_MAX_DISTANCE = 26;

export type { RgbBitmap } from "./obb-detect";

export interface PhashIndexEntry {
  tcgdexId: string;
  hash: string;
}

export interface PhashIndex {
  language: "en";
  entries: PhashIndexEntry[];
}

export interface PhashMatch {
  tcgdexId: string;
  distance: number;
  confidence: RecognitionConfidence;
}

export type StillImageDecoder = (
  image: Uint8Array,
  mimeType: IdentifyCardRequest["mimeType"],
) => Promise<RgbBitmap | null>;

export function normalizeEnglishTcgdexId(value: string | null | undefined): string | null {
  const id = normalizeLiveVideoTcgdexId(value);
  if (!id) return null;
  const setId = id.split("-")[0] ?? "";
  // Pocket series (A1, B1, P-A, …) — physical TCG only. Index builder also drops /tcgp/ art URLs.
  if (/^([ab]\d+[a-z]?|p-a)$/i.test(setId)) return null;
  return id;
}

function pixelChannel(image: RgbBitmap, index: number, channel: number): number {
  return image.data[index * 3 + channel] ?? 0;
}

function dctCosTable(): number[][] {
  const n = RGB_PHASH_SIZE;
  const table: number[][] = [];
  for (let k = 0; k < RGB_PHASH_FREQ; k++) {
    const row: number[] = [];
    for (let i = 0; i < n; i++) {
      row.push(Math.cos(((2 * i + 1) * k * Math.PI) / (2 * n)));
    }
    table.push(row);
  }
  return table;
}

const DCT_COS = dctCosTable();

/** Separable DCT-II for the 6×6 low-frequency block pHash actually reads. */
function computeDct(channel: number[]): number[] {
  const n = RGB_PHASH_SIZE;
  const freq = RGB_PHASH_FREQ;
  const tmp = new Array<number>(n * freq);
  for (let y = 0; y < n; y++) {
    for (let u = 0; u < freq; u++) {
      let sum = 0;
      const cosU = DCT_COS[u]!;
      for (let x = 0; x < n; x++) {
        sum += (channel[y * n + x] ?? 0) * (cosU[x] ?? 0);
      }
      tmp[y * freq + u] = sum;
    }
  }
  const result = new Array<number>(n * n).fill(0);
  const scale = 2 / n;
  for (let u = 0; u < freq; u++) {
    const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
    for (let v = 0; v < freq; v++) {
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      const cosV = DCT_COS[v]!;
      let sum = 0;
      for (let y = 0; y < n; y++) {
        sum += (tmp[y * freq + u] ?? 0) * (cosV[y] ?? 0);
      }
      result[u * n + v] = scale * cu * cv * sum;
    }
  }
  return result;
}

function channelAverage(dct: number[], freqSize: number): number {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < freqSize; y++) {
    for (let x = 0; x < freqSize; x++) {
      if (x === 0 && y === 0) continue;
      sum += dct[y * RGB_PHASH_SIZE + x] ?? 0;
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}

/**
 * 24×24 RGB DCT perceptual hash. Same detect+hash approach as the TCG Pocket
 * scanner pipeline; CardFlow keys the index by English `tcgdex_id`, never Pocket ids.
 */
export function rgbPerceptualHash(image: RgbBitmap): string {
  const small = resizeRgb(image, RGB_PHASH_SIZE, RGB_PHASH_SIZE);
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const count = RGB_PHASH_SIZE * RGB_PHASH_SIZE;
  for (let i = 0; i < count; i++) {
    r.push(pixelChannel(small, i, 0));
    g.push(pixelChannel(small, i, 1));
    b.push(pixelChannel(small, i, 2));
  }
  const dctR = computeDct(r);
  const dctG = computeDct(g);
  const dctB = computeDct(b);
  const avgR = channelAverage(dctR, RGB_PHASH_FREQ);
  const avgG = channelAverage(dctG, RGB_PHASH_FREQ);
  const avgB = channelAverage(dctB, RGB_PHASH_FREQ);
  let hash = "";
  for (let y = 0; y < RGB_PHASH_FREQ; y++) {
    for (let x = 0; x < RGB_PHASH_FREQ; x++) {
      if (x === 0 && y === 0) continue;
      const pos = y * RGB_PHASH_SIZE + x;
      hash += (dctR[pos] ?? 0) > avgR ? "1" : "0";
      hash += (dctG[pos] ?? 0) > avgG ? "1" : "0";
      hash += (dctB[pos] ?? 0) > avgB ? "1" : "0";
    }
  }
  return hash;
}

export function hammingDistance(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  let distance = Math.abs(left.length - right.length);
  for (let i = 0; i < length; i++) {
    if (left[i] !== right[i]) distance += 1;
  }
  return distance;
}

export function confidenceForDistance(distance: number): RecognitionConfidence | null {
  if (distance <= PHASH_HIGH_MAX_DISTANCE) return "High";
  if (distance <= PHASH_MEDIUM_MAX_DISTANCE) return "Medium";
  if (distance <= PHASH_LOW_MAX_DISTANCE) return "Low";
  return null;
}

export function parsePhashIndex(value: unknown): PhashIndex {
  const record = value as { language?: unknown; entries?: unknown };
  const entriesIn = Array.isArray(record?.entries) ? record.entries : [];
  const entries: PhashIndexEntry[] = [];
  for (const item of entriesIn) {
    const row = item as { tcgdexId?: unknown; tcgdex_id?: unknown; hash?: unknown };
    const tcgdexId = normalizeEnglishTcgdexId(
      typeof row.tcgdexId === "string" ? row.tcgdexId : typeof row.tcgdex_id === "string" ? row.tcgdex_id : null,
    );
    const hash = typeof row.hash === "string" ? row.hash : "";
    if (!tcgdexId || hash.length === 0) continue;
    entries.push({ tcgdexId, hash });
  }
  return { language: "en", entries };
}

export function matchRgbPhash(hash: string, index: PhashIndex): PhashMatch[] {
  const matches: PhashMatch[] = [];
  for (const entry of index.entries) {
    const tcgdexId = normalizeEnglishTcgdexId(entry.tcgdexId);
    if (!tcgdexId) continue;
    const distance = hammingDistance(hash, entry.hash);
    const confidence = confidenceForDistance(distance);
    if (!confidence) continue;
    matches.push({ tcgdexId, distance, confidence });
  }
  matches.sort((left, right) => left.distance - right.distance || left.tcgdexId.localeCompare(right.tcgdexId));
  const unique = new Map<string, PhashMatch>();
  for (const match of matches) {
    if (!unique.has(match.tcgdexId)) unique.set(match.tcgdexId, match);
  }
  return [...unique.values()];
}

function fillRgb(
  width: number,
  height: number,
  color: readonly [number, number, number],
  paint?: (set: (x: number, y: number, rgb: readonly [number, number, number]) => void) => void,
): RgbBitmap {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    data[i * 3] = color[0];
    data[i * 3 + 1] = color[1];
    data[i * 3 + 2] = color[2];
  }
  const set = (x: number, y: number, rgb: readonly [number, number, number]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 3;
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
  };
  paint?.(set);
  return { width, height, data };
}

/** Synthetic stills — not TCGdex art, not TCG Pocket images. */
export function ciStillBitmap(tcgdexId: "base1-58" | "base1-4"): RgbBitmap {
  if (tcgdexId === "base1-58") {
    return fillRgb(48, 64, [255, 214, 0], (set) => {
      for (let y = 8; y < 28; y++) {
        for (let x = 10; x < 38; x++) set(x, y, [24, 24, 24]);
      }
      for (let y = 36; y < 52; y++) {
        for (let x = 16; x < 32; x++) set(x, y, [40, 90, 200]);
      }
    });
  }
  return fillRgb(48, 64, [196, 36, 28], (set) => {
    for (let y = 4; y < 60; y++) {
      for (let x = 20; x < 28; x++) set(x, y, [250, 250, 250]);
    }
  });
}

export interface MessyCiCardStill {
  bitmap: RgbBitmap;
  box: ObbBox;
  tcgdexId: "base1-58" | "base1-4";
}

/**
 * Off-center, rotated CI still on a table backdrop. Full-frame hash misses;
 * OBB crop recovers the `tcgdex_id`. Not TCGdex art and not Pocket images.
 */
export function composeMessyCiCardStill(
  tcgdexId: "base1-58" | "base1-4" = "base1-58",
  options: { angleDeg?: number } = {},
): MessyCiCardStill {
  const card = resizeRgb(ciStillBitmap(tcgdexId), 180, 240);
  const width = 640;
  const height = 480;
  const angle = ((options.angleDeg ?? 18) * Math.PI) / 180;
  const cx = 250;
  const cy = 270;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const halfW = card.width / 2;
  const halfH = card.height / 2;
  const bitmap = fillRgb(width, height, [96, 58, 28], (set) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const stripe = (y * 3 + x) % 7;
        set(x, y, [88 + stripe * 3, 52 + (x % 5), 24 + (y % 4)]);
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const localX = dx * cos + dy * sin + halfW;
        const localY = -dx * sin + dy * cos + halfH;
        if (localX < 0 || localY < 0 || localX >= card.width || localY >= card.height) continue;
        set(x, y, [
          sampleRgb(card, localX - 0.5, localY - 0.5, 0),
          sampleRgb(card, localX - 0.5, localY - 0.5, 1),
          sampleRgb(card, localX - 0.5, localY - 0.5, 2),
        ]);
      }
    }
  });
  return {
    bitmap,
    box: { cx, cy, width: card.width, height: card.height, angle, score: 0.95 },
    tcgdexId,
  };
}

export function ciPhashIndex(): PhashIndex {
  return {
    language: "en",
    entries: [
      { tcgdexId: "base1-58", hash: rgbPerceptualHash(ciStillBitmap("base1-58")) },
      { tcgdexId: "base1-4", hash: rgbPerceptualHash(ciStillBitmap("base1-4")) },
    ],
  };
}

function candidateFromMatch(match: PhashMatch, rank: number): RecognitionCandidate {
  return {
    vendorCardId: match.tcgdexId,
    name: null,
    setName: null,
    number: null,
    language: "en",
    fields: [
      { key: "tcgdex_id", value: match.tcgdexId },
      { key: "phash_distance", value: String(match.distance) },
      { key: "confidence", value: match.confidence },
    ],
    rank,
  };
}

export function emptyObbPhashResult(
  processingTimeMs: number | null = null,
): CardFlowNormalizedRecognitionResult {
  return {
    provider: "obb_phash",
    ok: true,
    vendorRequestId: null,
    processingTimeMs,
    detections: [],
    error: null,
  };
}

export function recognitionFromPhashMatches(
  matches: PhashMatch[],
  processingTimeMs: number | null = null,
): CardFlowNormalizedRecognitionResult {
  if (matches.length === 0) return emptyObbPhashResult(processingTimeMs);
  const highCount = matches.filter((match) => match.confidence === "High").length;
  const best = matches[0]!;
  const confidence: RecognitionConfidence =
    highCount > 1 ? "Medium" : best.confidence;
  const detection: RecognitionDetection = {
    confidence,
    matchLevel: highCount > 1 ? "ambiguous" : "phash",
    vendorCardId: best.tcgdexId,
    name: null,
    setName: null,
    number: null,
    language: "en",
    fields: [
      { key: "tcgdex_id", value: best.tcgdexId },
      { key: "phash_distance", value: String(best.distance) },
    ],
    candidates: matches.map((match, index) => candidateFromMatch(match, index + 1)),
  };
  return {
    provider: "obb_phash",
    ok: true,
    vendorRequestId: null,
    processingTimeMs,
    detections: [detection],
    error: null,
  };
}

export async function identifyObbPhashBitmap(
  image: RgbBitmap,
  options: { index?: PhashIndex; detector?: ObbDetector } = {},
): Promise<CardFlowNormalizedRecognitionResult> {
  const started = Date.now();
  const detector = options.detector ?? fullFrameObbDetector;
  const index = options.index ?? ciPhashIndex();
  const boxes = await detector.detect(image);
  const best = bestObbBox(boxes);
  if (!best) return emptyObbPhashResult(Date.now() - started);
  const crop = cropOrientedBox(image, best);
  const hash = rgbPerceptualHash(crop);
  return recognitionFromPhashMatches(matchRgbPhash(hash, index), Date.now() - started);
}

export function createObbPhashRecognitionProvider(options: {
  decode: StillImageDecoder;
  index?: PhashIndex;
  detector?: ObbDetector;
}): CardRecognitionProvider {
  const index = options.index ?? ciPhashIndex();
  const detector = options.detector ?? createYolo11NanoObbDetector();
  return {
    name: "obb_phash",
    async identifyCard(req) {
      const bitmap = await options.decode(req.image, req.mimeType);
      if (!bitmap || bitmap.width < 1 || bitmap.height < 1) {
        return emptyObbPhashResult(0);
      }
      return identifyObbPhashBitmap(bitmap, { index, detector });
    },
  };
}

export { createYolo11NanoObbDetector, fullFrameObbDetector, noCardObbDetector } from "./obb-detect";
export type { ObbBox, ObbDetector, Yolo11ObbInference } from "./obb-detect";
