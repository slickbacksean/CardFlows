import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Full 14-photo mode (Sean, Oct 18): the grader has no input for the tilted or corner
 * close-up photos yet, so they're kept on disk for later grader work. Only runs while
 * CARD_FLOW_GRADE_FULL_MODE=on (off by default). apps/api/data/ is gitignored.
 * Gap before a Premium launch: no retention/cleanup and no per-grade linking (docs/GRADE_FULL_MODE.md).
 */
const EXTRA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "grade-extras");

export function saveGradeExtraShot(input: {
  userId: string;
  side: string;
  shot: string;
  still: { bytes: Uint8Array; mimeType: string };
}): boolean {
  if (process.env.VITEST) return false;
  try {
    const dir = path.join(EXTRA_DIR, input.userId.replace(/[^a-zA-Z0-9_-]/g, "_"));
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = input.still.mimeType === "image/png" ? ".png" : input.still.mimeType === "image/webp" ? ".webp" : ".jpg";
    writeFileSync(path.join(dir, `${stamp}-${input.side}-${input.shot}${ext}`), input.still.bytes);
    return true;
  } catch {
    return false;
  }
}
