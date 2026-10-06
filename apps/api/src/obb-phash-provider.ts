import { readFileSync } from "node:fs";
import {
  ciPhashIndex,
  createObbPhashRecognitionProvider,
  parsePhashIndex,
  type CardRecognitionProvider,
  type PhashIndex,
} from "@cardflow/shared";
import { decodeScanStill } from "./obb-phash-decode";
import { createObbDetectorFromEnv } from "./obb-onnx";
import { resolvePhashIndexPath } from "./obb-phash-index";

type Env = NodeJS.Dict<string | undefined>;

function envValue(env: Env, key: string): string | undefined {
  const value = env[key];
  if (value === undefined || value.trim() === "") return undefined;
  return value.trim();
}

function loadPhashIndex(env: Env): PhashIndex {
  return loadOptionalPhashIndex(env) ?? ciPhashIndex();
}

/** Livestream identity. Missing file → unidentified (no CI fixture fallback). */
export function loadOptionalPhashIndex(env: Env = process.env): PhashIndex | null {
  const pathName = envValue(env, "CARD_FLOW_OBB_PHASH_INDEX");
  const resolved = pathName ? resolvePhashIndexPath(pathName) : undefined;
  if (!resolved) return null;
  try {
    const parsed = parsePhashIndex(JSON.parse(readFileSync(resolved, "utf8")));
    return parsed.entries.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Capture still adapter: YOLO11 Nano OBB crop + RGB pHash vs English `tcgdex_id`.
 * Gitignored `.onnx` is loaded from `CARD_FLOW_OBB_ONNX_PATH` after AGPL accept.
 * CI uses a full-frame crop + tiny fixture index.
 */
export function createApiObbPhashProvider(env: Env = process.env): CardRecognitionProvider {
  return createObbPhashRecognitionProvider({
    decode: decodeScanStill,
    index: loadPhashIndex(env),
    detector: createObbDetectorFromEnv(env),
  });
}
