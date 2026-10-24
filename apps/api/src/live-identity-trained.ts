/**
 * PokeSniper in-house trained recognizer: DINOv2-S + SubCenterArcFace.
 * Loads b1_best.pt weights and precomputed catalog embeddings, embeds crops,
 * matches by cosine similarity (average of art-crop + full-card scores).
 * Falls back to OpenCLIP when model is not configured.
 * 
 * Model: timm vit_small_patch14_dinov2.lvd142m, last 8 blocks + norm unfrozen,
 * residual head (384->384 linear, zero-init), L2 normalize output.
 * 
 * Env:
 * - CARD_FLOW_TRAINED_MODEL_WEIGHTS: Path or URL to b1_best.pt (~148 MB)
 * - CARD_FLOW_TRAINED_MODEL_CAT_FULL: Path or URL to cat_full_b1.npy
 * - CARD_FLOW_TRAINED_MODEL_CAT_ART: Path or URL to cat_art_b1.npy
 * - CARD_FLOW_TRAINED_MODEL_CAT_IDS: Path or URL to cat_ids.json
 */

import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { RecognitionImageMimeType } from "@cardflow/shared";

// ImageNet normalization constants
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

// Art crop region (fraction of W, H): [x0, y0, x1, y1]
const ART_CROP = [0.09, 0.10, 0.91, 0.50];

export interface TrainedModelMatch {
  tcgdexId: string;
  similarity: number;
  accepted: boolean;
  pipeline: "trained_dinov2";
  candidates?: { tcgdexId: string; similarity: number }[];
  timings?: Partial<Record<"decodeMs" | "embedMs" | "searchMs" | "totalMs", number>>;
}

export interface TrainedModelOptions {
  weightsPath: string;
  catFullPath: string;
  catArtPath: string;
  catIdsPath: string;
  acceptThreshold?: number;
  topK?: number;
}

interface ModelState {
  initialized: boolean;
  onnxSession: any;  // onnxruntime InferenceSession
  catFull: Float32Array;
  catArt: Float32Array;
  catIds: string[];
  headWeights: Float32Array;
}

const state: ModelState = {
  initialized: false,
  onnxSession: null,
  catFull: new Float32Array(0),
  catArt: new Float32Array(0),
  catIds: [],
  headWeights: new Float32Array(0),
};

async function downloadFile(urlOrPath: string, destPath: string): Promise<void> {
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    const response = await fetch(urlOrPath);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download ${urlOrPath}: ${response.statusText}`);
    }
    mkdirSync(path.dirname(destPath), { recursive: true });
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(destPath));
  }
}

async function ensureFile(urlOrPath: string, cacheName: string): Promise<string> {
  if (!urlOrPath.startsWith("http://") && !urlOrPath.startsWith("https://")) {
    if (!existsSync(urlOrPath)) {
      throw new Error(`Model file not found: ${urlOrPath}`);
    }
    return urlOrPath;
  }
  const cacheDir = path.join(process.cwd(), ".cache", "trained-model");
  const localPath = path.join(cacheDir, cacheName);
  if (existsSync(localPath)) {
    return localPath;
  }
  console.info(`[trained-model] Downloading ${cacheName} from ${urlOrPath}`);
  await downloadFile(urlOrPath, localPath);
  return localPath;
}

/**
 * Initialize the trained model from weights and catalog embeddings.
 * This is CPU-only for now; ONNX export or quantization may be needed for production.
 */
export async function initTrainedModel(options: TrainedModelOptions): Promise<void> {
  if (state.initialized) return;
  
  console.info("[trained-model] Initializing DINOv2-S + SubCenterArcFace model...");
  const startMs = Date.now();
  
  try {
    // For now, we'll use a placeholder implementation that loads the files
    // but doesn't actually run inference (will add ONNX runtime in next step)
    
    const [weightsPath, catFullPath, catArtPath, catIdsPath] = await Promise.all([
      ensureFile(options.weightsPath, "b1_best.pt"),
      ensureFile(options.catFullPath, "cat_full_b1.npy"),
      ensureFile(options.catArtPath, "cat_art_b1.npy"),
      ensureFile(options.catIdsPath, "cat_ids.json"),
    ]);
    
    // Load catalog IDs
    const catIdsJson = await readFile(catIdsPath, "utf-8");
    state.catIds = JSON.parse(catIdsJson) as string[];
    
    // Load catalog embeddings (NumPy .npy format: skip 128-byte header, then float16 data)
    const catFullBuf = await readFile(catFullPath);
    const catArtBuf = await readFile(catArtPath);
    
    // Parse .npy files (simple format: magic + header + data)
    // For now, we'll need npy parsing or convert to simpler format
    // TODO: Parse .npy format properly or pre-convert to .bin
    
    state.initialized = true;
    const elapsedMs = Date.now() - startMs;
    console.info(`[trained-model] Model initialized in ${elapsedMs}ms`);
    console.info(`[trained-model] Catalog: ${state.catIds.length} cards`);
  } catch (error) {
    console.error("[trained-model] Failed to initialize model:", error);
    throw error;
  }
}

/**
 * Check if the trained model is available and initialized.
 */
export function isTrainedModelAvailable(): boolean {
  return state.initialized;
}

/**
 * Match a crop against the trained model catalog.
 * Returns top candidates with similarities.
 */
export async function matchCropWithTrainedModel(
  bytes: Uint8Array,
  mimeType: RecognitionImageMimeType,
  options: { topK?: number; acceptThreshold?: number } = {},
): Promise<TrainedModelMatch | null> {
  if (!state.initialized) {
    return null;
  }
  
  const topK = options.topK ?? 5;
  const acceptThreshold = options.acceptThreshold ?? 0.68;
  
  try {
    const startMs = Date.now();
    
    // TODO: Implement actual inference
    // 1. Decode image
    // 2. Preprocess (224x224 center crop, normalize)
    // 3. Run through model (ONNX runtime)
    // 4. Compute similarity with catalog embeddings
    // 5. Return top-K candidates
    
    const totalMs = Date.now() - startMs;
    
    // Placeholder: return null for now
    return null;
  } catch (error) {
    console.error("[trained-model] Inference error:", error);
    return null;
  }
}

export function resolveTrainedModelFromEnv(env: NodeJS.ProcessEnv = process.env): {
  options: TrainedModelOptions | null;
  reason: string;
} {
  const weightsPath = env.CARD_FLOW_TRAINED_MODEL_WEIGHTS?.trim();
  const catFullPath = env.CARD_FLOW_TRAINED_MODEL_CAT_FULL?.trim();
  const catArtPath = env.CARD_FLOW_TRAINED_MODEL_CAT_ART?.trim();
  const catIdsPath = env.CARD_FLOW_TRAINED_MODEL_CAT_IDS?.trim();
  
  if (!weightsPath || !catFullPath || !catArtPath || !catIdsPath) {
    const missing = [];
    if (!weightsPath) missing.push("CARD_FLOW_TRAINED_MODEL_WEIGHTS");
    if (!catFullPath) missing.push("CARD_FLOW_TRAINED_MODEL_CAT_FULL");
    if (!catArtPath) missing.push("CARD_FLOW_TRAINED_MODEL_CAT_ART");
    if (!catIdsPath) missing.push("CARD_FLOW_TRAINED_MODEL_CAT_IDS");
    return { options: null, reason: `Missing env vars: ${missing.join(", ")}` };
  }
  
  return {
    options: {
      weightsPath,
      catFullPath,
      catArtPath,
      catIdsPath,
      acceptThreshold: parseFloat(env.CARD_FLOW_TRAINED_MODEL_THRESHOLD ?? "0.68"),
      topK: parseInt(env.CARD_FLOW_TRAINED_MODEL_TOPK ?? "5", 10),
    },
    reason: "trained model configured",
  };
}
