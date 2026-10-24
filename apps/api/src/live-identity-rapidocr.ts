/**
 * RapidOCR card text extraction for Linux (Apache-2.0).
 * Extracts card names and collector numbers from crops, compatible with
 * the Apple Vision OCR flow but using onnxruntime models.
 * 
 * Env:
 * - CARD_FLOW_RAPIDOCR_ENABLED: Set to "1" to enable (default off)
 * - CARD_FLOW_RAPIDOCR_MODELS: Path to RapidOCR models directory (optional)
 */

import { createReadStream, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RgbBitmap } from "@cardflow/shared";

// Common stop words on cards (not part of names)
const STOP_WORDS = new Set([
  "pokemon",
  "pokémon",
  "basic",
  "stage",
  "evolves",
  "from",
  "hp",
  "weakness",
  "resistance",
  "retreat",
  "attack",
  "trainer",
  "energy",
  "item",
  "tool",
  "supporter",
  "stadium",
  "put",
  "damage",
  "counter",
  "coin",
  "flip",
  "discard",
  "draw",
  "search",
  "shuffle",
  "deck",
  "hand",
  "benched",
  "active",
]);

function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

interface RapidOCRResult {
  text: string;
  box: number[][];
  score: number;
}

let ocrEngine: any = null;
let ocrInitialized = false;

/**
 * Initialize RapidOCR engine. Call once at startup.
 */
export async function initRapidOCR(): Promise<void> {
  if (ocrInitialized) return;

  try {
    // Dynamic import to avoid loading on macOS where Apple Vision is preferred
    const { RapidOCR } = await import("rapidocr-node");
    ocrEngine = await RapidOCR.create();
    ocrInitialized = true;
    console.info("[rapidocr] Initialized RapidOCR engine");
  } catch (error) {
    console.error("[rapidocr] Failed to initialize:", error);
    throw error;
  }
}

/**
 * Extract card names from OCR text.
 * Returns normalized name tokens (length >= 3, not stop words).
 */
export function cardNameCandidatesFromRapidOCR(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  // Split into lines, extract words
  const lines = text.split(/\r?\n/);
  const titleLines: string[] = [];
  const bodyWords: string[] = [];

  for (const line of lines) {
    const words = line
      .replace(/[^A-Za-z' -]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/^'+|'+$/g, ""))
      .filter((w) => /^[A-Za-z][A-Za-z'-]*$/.test(w));

    const longWords = words.filter((w) => {
      const norm = normalizeForMatch(w);
      return norm.length >= 3 && !STOP_WORDS.has(norm);
    });

    // Single long word on a line = likely a title (e.g., "Charizard")
    if (longWords.length === 1 && words.length === 1) {
      titleLines.push(longWords[0]!);
    } else {
      // Multi-word line or mixed: extract individual long words + phrases
      if (longWords.length >= 2) {
        bodyWords.push(longWords.join(" "));
      }
      bodyWords.push(...longWords);
    }
  }

  // Title lines first, then body
  for (const piece of [...titleLines, ...bodyWords]) {
    const name = piece
      .split(/([\s-])/)
      .map((part) =>
        /^[A-Za-z]/.test(part) ? part[0]!.toUpperCase() + part.slice(1).toLowerCase() : part,
      )
      .join("");

    const key = normalizeForMatch(name);
    if (key.length >= 3 && !seen.has(key)) {
      seen.add(key);
      found.push(name);
    }
  }

  return found;
}

/**
 * Extract printed collector number from OCR text.
 * Looks for patterns like "078/084", "SWSH261", "GG70", etc.
 */
export function printedCollectorNumberFromRapidOCR(text: string): string | null {
  // Look for fraction patterns (most common): 123/456, 025/102, etc.
  const fractionMatches = [...text.matchAll(/\b(\d{1,3})\s*\/\s*(\d{2,3})\b/g)];
  if (fractionMatches.length > 0) {
    // Last match is usually at the bottom of the card
    const last = fractionMatches[fractionMatches.length - 1];
    if (last && last[1]) {
      const local = Number(last[1]);
      const official = last[2] ? Number(last[2]) : 0;
      // Basic sanity check
      if (local > 0 && local <= official + 80 && official >= 10) {
        return String(local);
      }
    }
  }

  // Look for standalone patterns: SWSH261, GG70, TG01, etc.
  const patterns = [...text.matchAll(/\b([A-Z]{2,4}\d{1,4})\b/g)];
  for (const match of patterns) {
    if (match && match[1]) {
      const normalized = normalizeForMatch(match[1]);
      // Must have at least one digit
      if (/\d/.test(normalized)) {
        return normalized;
      }
    }
  }

  return null;
}

/**
 * Run OCR on a PNG image buffer and extract card text.
 * Returns raw OCR text (lines separated by newlines).
 */
export async function recognizeCardTextRapidOCR(pngBytes: Uint8Array): Promise<string> {
  if (!ocrInitialized || !ocrEngine) {
    return "";
  }

  try {
    // RapidOCR expects a file path or buffer
    // Convert Uint8Array to Buffer for compatibility
    const buffer = Buffer.from(pngBytes);
    
    // Run OCR
    const result = await ocrEngine.recognize(buffer);
    
    if (!result || result.type !== "ocr" || !result.lines) {
      return "";
    }

    // Extract text from results
    const lines = result.lines
      .filter((line: any) => line && line.text)
      .map((line: any) => line.text)
      .filter((t: string) => t.trim().length > 0);

    return lines.join("\n");
  } catch (error) {
    console.error("[rapidocr] Recognition error:", error);
    return "";
  }
}

/**
 * Check if RapidOCR is available and enabled.
 */
export function isRapidOCRAvailable(): boolean {
  return ocrInitialized && ocrEngine !== null;
}

export function resolveRapidOCRFromEnv(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  reason: string;
} {
  const enabled = env.CARD_FLOW_RAPIDOCR_ENABLED?.trim() === "1";
  
  if (!enabled) {
    return { enabled: false, reason: "CARD_FLOW_RAPIDOCR_ENABLED not set to 1" };
  }

  return { enabled: true, reason: "RapidOCR enabled" };
}
