import { execFile } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  bestObbBox,
  cropOrientedBox,
  emptyObbPhashResult,
  matchRgbPhash,
  recognitionFromPhashMatches,
  rgbPerceptualHash,
  type CardCatalogProvider,
  type CardFlowNormalizedRecognitionResult,
  type CardRecognitionProvider,
  type PhashIndex,
  type RecognitionImageMimeType,
  type TcgdexCard,
} from "@cardflow/shared";
import { decodeScanStill, encodePngStill } from "./obb-phash-decode";
import { createObbDetectorFromEnv } from "./obb-onnx";
import { loadOptionalPhashIndex } from "./obb-phash-provider";
import type { LiveIdentityOpenclipClient } from "./live-identity-openclip";

const execFileAsync = promisify(execFile);
const apiRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const visionBinary = path.join(apiRoot, ".cache", "vision-ocr");
const visionSource = path.join(apiRoot, "scripts", "vision-ocr.swift");

const NAME_STOP_WORDS = new Set([
  "basic",
  "stage",
  "item",
  "supporter",
  "stadium",
  "energy",
  "weakness",
  "resistance",
  "retreat",
  "pokemon",
  "attack",
  "discard",
  "damage",
  "controlled",
  "reveal",
  "bottom",
  "shuffle",
  "opponent",
]);

export interface PrintedCollectorNumber {
  /** Unpadded collector number, e.g. `78` from `078/084`. */
  localId: string;
  /** Printed set size, the number after the slash. */
  officialCount: number;
}

function wordsOnOcrLine(rawLine: string): string[] {
  return rawLine
    .replace(/[^A-Za-z' -]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^'+|'+$/g, ""))
    .filter((word) => /^[A-Za-z][A-Za-z'-]*$/.test(word));
}

function isNameWord(word: string): boolean {
  return word.length >= 5 && word.length <= 24 && !NAME_STOP_WORDS.has(word.toLowerCase());
}

function titleCaseName(piece: string): string {
  return piece
    .split(/([\s-])/)
    .map((part) =>
      /^[A-Za-z]/.test(part) ? part[0]!.toUpperCase() + part.slice(1).toLowerCase() : part,
    )
    .join("");
}

/**
 * Printed name lines from a card crop. A line that is only the card name
 * (Supporter titles like Gwynn) comes before words pulled out of effect text.
 * Short OCR noise ("BASIC" → "BASS") is dropped.
 */
export function cardNameCandidatesFromOcr(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const titles: string[] = [];
  const body: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const words = wordsOnOcrLine(rawLine);
    const longWords = words.filter(isNameWord);
    if (longWords.length === 1 && words.length === 1) {
      titles.push(longWords[0]!);
      continue;
    }
    const pieces = longWords.length >= 2 ? [longWords.join(" "), ...longWords] : longWords;
    body.push(...pieces);
  }
  for (const piece of [...titles, ...body]) {
    const name = titleCaseName(piece);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(name);
  }
  return found;
}

/** Bottom collector fraction (`078/084`). The last match is the one at the foot of the card. */
export function printedCollectorNumberFromOcr(text: string): PrintedCollectorNumber | null {
  const matches = [...text.matchAll(/\b(\d{1,3})\s*\/\s*(\d{2,3})\b/g)];
  const last = matches.at(-1);
  if (!last?.[1] || !last[2]) return null;
  const local = Number(last[1]);
  const official = Number(last[2]);
  if (!Number.isInteger(local) || !Number.isInteger(official)) return null;
  if (local <= 0 || official < 10 || official > 999) return null;
  // Secret rares print above the official count (109/084). A slash that is not a collector number does not.
  if (local > official + 80) return null;
  return { localId: String(local), officialCount: official };
}

function namesEqual(left: string, right: string): boolean {
  return left
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "") ===
    right
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "");
}

function sameLocalId(left: string, right: string): boolean {
  const digits = (value: string) => value.replace(/\D/g, "").replace(/^0+/, "") || "0";
  return digits(left) === digits(right);
}

function localIdLookupKeys(localId: string): string[] {
  const unpadded = localId.replace(/\D/g, "").replace(/^0+/, "") || "0";
  const padded = unpadded.padStart(3, "0");
  return padded === unpadded ? [unpadded] : [unpadded, padded];
}

function pickNamedPrint(
  cards: TcgdexCard[],
  name: string,
  printed: PrintedCollectorNumber | null,
): string | null {
  const exact = cards.filter((card) => namesEqual(card.name, name));
  if (!printed) return null;
  const numbered = exact.filter((card) => sameLocalId(card.localId, printed.localId));
  const sized = numbered.filter((card) => card.set.cardCount.official === printed.officialCount);
  if (sized.length === 1) return sized[0]!.id;
  if (numbered.length === 1 && numbered[0]!.set.cardCount.official === 0) return numbered[0]!.id;
  return null;
}

/**
 * Trainer titles are often a display font Vision misses, while `078/084` is plain.
 * Resolve that fraction against the printed set size, and use a read name to pick
 * among prints when the set search is ambiguous.
 */
export async function tcgdexIdFromPrintedOcr(
  catalog: CardCatalogProvider,
  text: string,
): Promise<string | null> {
  const printed = printedCollectorNumberFromOcr(text);
  const names = cardNameCandidatesFromOcr(text).slice(0, 4);
  try {
    if (printed) {
      for (const name of names) {
        const cards = await catalog.listCards({ language: "en", name });
        const id = pickNamedPrint(cards, name, printed);
        if (id) return id;
      }
    }
    if (!printed || !catalog.listSets) return null;
    const sets = (await catalog.listSets("en")).filter(
      (set) => set.cardCount.official === printed.officialCount,
    );
    const hits: string[] = [];
    for (const set of sets.slice(0, 12)) {
      for (const localId of localIdLookupKeys(printed.localId)) {
        const card = await catalog.getCardBySetAndLocalId(set.id, localId, "en");
        if (!card || !sameLocalId(card.localId, printed.localId)) continue;
        hits.push(card.id);
        break;
      }
    }
    const unique = [...new Set(hits)];
    return unique.length === 1 ? unique[0]! : null;
  } catch {
    return null;
  }
}

async function ensureVisionBinary(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  if (existsSync(visionBinary)) return visionBinary;
  if (!existsSync(visionSource)) return null;
  mkdirSync(path.dirname(visionBinary), { recursive: true });
  try {
    await execFileAsync(
      "swiftc",
      ["-O", "-framework", "Vision", "-framework", "AppKit", visionSource, "-o", visionBinary],
      { timeout: 120_000 },
    );
  } catch {
    return null;
  }
  return existsSync(visionBinary) ? visionBinary : null;
}

/** Apple Vision on the crop. Empty when the helper is unavailable. */
export async function recognizeCardText(png: Uint8Array): Promise<string> {
  const binary = await ensureVisionBinary();
  if (!binary || png.byteLength < 32) return "";
  const filePath = path.join(tmpdir(), `cardflow-ocr-${process.pid}-${Date.now()}.png`);
  writeFileSync(filePath, png);
  try {
    const { stdout } = await execFileAsync(binary, [filePath], {
      timeout: 12_000,
      maxBuffer: 256_000,
    });
    return stdout;
  } catch {
    return "";
  } finally {
    try {
      unlinkSync(filePath);
    } catch {
      // temp crop is best-effort
    }
  }
}

export function recognitionFromNamedPrint(
  tcgdexId: string,
  similarity: number | null,
): CardFlowNormalizedRecognitionResult {
  return {
    provider: "obb_phash",
    ok: true,
    vendorRequestId: null,
    processingTimeMs: null,
    detections: [
      {
        confidence: "High",
        matchLevel: "openclip_name",
        vendorCardId: tcgdexId,
        name: null,
        setName: null,
        number: null,
        language: "en",
        fields: [
          { key: "tcgdex_id", value: tcgdexId },
          { key: "openclip_similarity", value: similarity == null ? "" : String(similarity) },
        ],
        candidates: [],
      },
    ],
    error: null,
  };
}

/**
 * Capture stills: crop the card, read the printed name, then pick that
 * print with OpenCLIP. A Supporter whose title does not OCR still resolves
 * from the collector fraction (`078/084`) plus the printed set size.
 * Phone photos of official art stay too far apart for an unfiltered hash.
 */
export async function identifyLiveCaptureStill(input: {
  image: Uint8Array;
  mimeType: RecognitionImageMimeType;
  fallback: CardRecognitionProvider;
  openclip: LiveIdentityOpenclipClient | null;
  catalog?: CardCatalogProvider | null;
  env?: NodeJS.Dict<string | undefined>;
  index?: PhashIndex | null;
  recognizeText?: (png: Uint8Array) => Promise<string>;
}): Promise<CardFlowNormalizedRecognitionResult> {
  if (!input.openclip && !input.catalog) {
    return input.fallback.identifyCard({ image: input.image, mimeType: input.mimeType });
  }
  const bitmap = await decodeScanStill(input.image, input.mimeType);
  if (!bitmap) return input.fallback.identifyCard({ image: input.image, mimeType: input.mimeType });
  const detector = createObbDetectorFromEnv(input.env);
  const best = bestObbBox(await detector.detect(bitmap));
  if (!best) return emptyObbPhashResult(0);
  // The still detector's small angle skews a nearly upright phone photo and
  // drops the printed name out of the crop. Keep a real tilt.
  const angle = Math.abs(best.angle) < 0.2 ? 0 : best.angle;
  const crop = cropOrientedBox(bitmap, { ...best, angle });
  const tight = crop.width * crop.height < bitmap.width * bitmap.height * 0.92;
  const png = encodePngStill(crop);
  const text = await (input.recognizeText ?? recognizeCardText)(png);
  if (tight && input.openclip) {
    for (const name of cardNameCandidatesFromOcr(text).slice(0, 3)) {
      const match = await input.openclip.matchCropJpeg(png, "image/png", { name });
      if (match?.accepted && match.tcgdexId) {
        return recognitionFromNamedPrint(match.tcgdexId, match.similarity);
      }
    }
  }
  if (input.catalog && text.trim()) {
    const printedId = await tcgdexIdFromPrintedOcr(input.catalog, text);
    if (printedId) return recognitionFromNamedPrint(printedId, null);
  }
  const index = input.index === undefined ? loadOptionalPhashIndex(input.env) : input.index;
  if (!index) return input.fallback.identifyCard({ image: input.image, mimeType: input.mimeType });
  return recognitionFromPhashMatches(matchRgbPhash(rgbPerceptualHash(crop), index));
}
