/**
 * Sean (Oct 25): Exports eligible training samples (ported from PR 117) into the training pipeline's folder format:
 *   <out>/images/<imageId>.<ext>
 *   <out>/labels.jsonl   one line per image: { file, card_id, label_source, crop_box, terms_version, ... }
 *   <out>/manifest.json  provenance + counts (pseudonymous user_hash, no raw user IDs)
 * 
 * Eligible = label source in TRAINING_ELIGIBLE_LABEL_SOURCES (never `cardsight_assisted`) and not
 * past the retention limit. Re-running replaces the previous export, so deleted/opted-out samples
 * disappear from it too.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isTrainingSampleExpired, TRAINING_ELIGIBLE_LABEL_SOURCES } from "@cardflow/shared";
import type { TrainingDataStorePort } from "./training-data-store";
import { getTrainingImage, trainingImagePath } from "./training-image-storage";

export interface TrainingExportResult {
  exported: number;
  excludedCardSightAssisted: number;
  excludedExpired: number;
  missingBytes: number;
  outDir: string;
}

export function exportTrainingSamples(options: {
  trainingData: TrainingDataStorePort;
  storageDir: string;
  retentionDays: number;
  now?: Date;
  outDir: string;
}): TrainingExportResult {
  const now = options.now ?? new Date();
  const imagesDir = path.join(options.outDir, "images");
  
  // Only replace a previous export (or an empty folder), never an arbitrary directory.
  if (existsSync(options.outDir) && readdirSync(options.outDir).length > 0) {
    if (!existsSync(path.join(options.outDir, "manifest.json"))) {
      throw new Error(`${options.outDir} is not empty and has no manifest.json; refusing to overwrite it.`);
    }
    rmSync(options.outDir, { recursive: true, force: true });
  }
  
  mkdirSync(imagesDir, { recursive: true, mode: 0o700 });
  
  const lines: string[] = [];
  let excludedCardSightAssisted = 0;
  let excludedExpired = 0;
  let missingBytes = 0;
  const termsVersions = new Set<string>();
  
  // Get all non-deleted training images
  const allImages = options.trainingData.listTrainingImages?.() ?? [];
  
  for (const meta of allImages) {
    // Skip if label source is CardSight-assisted
    if (meta.labelSource && !TRAINING_ELIGIBLE_LABEL_SOURCES.includes(meta.labelSource)) {
      excludedCardSightAssisted += 1;
      continue;
    }
    
    // Skip if expired
    if (isTrainingSampleExpired(meta.capturedAt, now, options.retentionDays)) {
      excludedExpired += 1;
      continue;
    }
    
    // Skip if deleted
    if (meta.deletedAt) {
      continue;
    }
    
    // Get image bytes
    const imageData = getTrainingImage(options.storageDir, meta.storageRef);
    if (!imageData) {
      missingBytes += 1;
      continue;
    }
    
    const file = path.basename(meta.storageRef);
    writeFileSync(path.join(imagesDir, file), imageData.bytes, { mode: 0o600 });
    termsVersions.add(meta.termsVersion);
    
    lines.push(
      JSON.stringify({
        file: `images/${file}`,
        card_id: meta.chosenTcgdexId || "unknown",
        label_source: meta.labelSource || "unknown",
        crop_box: meta.cropBox || null,
        source: "scan_a_card",
        user_hash: meta.pseudonymousUserId,
        terms_version: meta.termsVersion,
        captured_at: meta.capturedAt,
      }),
    );
  }
  
  writeFileSync(
    path.join(options.outDir, "labels.jsonl"),
    lines.length ? `${lines.join("\n")}\n` : "",
    { mode: 0o600 },
  );
  
  const manifest = {
    path: "user/",
    source: "PokeSniper Scan a Card photos confirmed by users (Terms; opt-out honored; 18+ only)",
    license: "User-provided under PokeSniper Terms of Service; internal training of PokeSniper's own card recognition only; never sold or shared",
    count: lines.length,
    exported_at: now.toISOString(),
    retention_days: options.retentionDays,
    label_sources: TRAINING_ELIGIBLE_LABEL_SOURCES,
    terms_versions: [...termsVersions].sort(),
    excluded: {
      cardsight_assisted: excludedCardSightAssisted,
      expired: excludedExpired,
      missing_bytes: missingBytes,
    },
    cardsight_outputs_used: false,
    whatnot_content_used: false,
    live_scan_frames: false,
  };
  
  writeFileSync(
    path.join(options.outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  
  return {
    exported: lines.length,
    excludedCardSightAssisted,
    excludedExpired,
    missingBytes,
    outDir: options.outDir,
  };
}
