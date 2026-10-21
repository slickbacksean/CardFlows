/**
 * Exports eligible user training samples (Sean, Oct 21) into the training pipeline's folder format:
 *   <out>/images/<sampleId>.<ext>
 *   <out>/labels.jsonl   one line per image: { file, card_id, variant, label_source, crop_box, ... }
 *   <out>/manifest.json  provenance + counts (no user IDs; user_hash is an HMAC)
 * Eligible = label source in TRAINING_ELIGIBLE_LABEL_SOURCES (never `cardsight_assisted`) and not
 * past the retention limit. Re-running replaces the previous export, so deleted/opted-out samples
 * disappear from it too.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isTrainingSampleExpired, TRAINING_ELIGIBLE_LABEL_SOURCES } from "@cardflow/shared";
import type { TrainingStore } from "./training-store";

export interface TrainingExportResult {
  exported: number;
  excludedCardSightAssisted: number;
  excludedExpired: number;
  missingBytes: number;
  outDir: string;
}

export function exportTrainingSamples(options: {
  store: TrainingStore;
  outDir: string;
  retentionMonths: number;
  now?: Date;
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
  for (const meta of options.store.listSamples()) {
    if (!TRAINING_ELIGIBLE_LABEL_SOURCES.includes(meta.labelSource)) {
      excludedCardSightAssisted += 1;
      continue;
    }
    if (isTrainingSampleExpired(meta.capturedAt, now, options.retentionMonths)) {
      excludedExpired += 1;
      continue;
    }
    const bytes = options.store.readSampleBytes(meta);
    if (!bytes) {
      missingBytes += 1;
      continue;
    }
    const file = path.basename(meta.file);
    writeFileSync(path.join(imagesDir, file), bytes, { mode: 0o600 });
    termsVersions.add(meta.termsVersion);
    lines.push(
      JSON.stringify({
        file: `images/${file}`,
        card_id: meta.tcgdexId,
        variant: meta.selectedVariant,
        label_source: meta.labelSource,
        crop_box: meta.cropBox,
        source: meta.source,
        user_hash: meta.userHash,
        terms_version: meta.termsVersion,
        captured_at: meta.capturedAt,
      }),
    );
  }
  writeFileSync(path.join(options.outDir, "labels.jsonl"), lines.length ? `${lines.join("\n")}\n` : "", { mode: 0o600 });
  const manifest = {
    path: "user/",
    source: "PokeSniper Scan a Card photos confirmed by users (Terms §5; opt-out honored; 18+ only)",
    license: "User-provided under PokeSniper Terms of Service; internal training of PokeSniper's own card recognition only; never sold or shared",
    count: lines.length,
    exported_at: now.toISOString(),
    retention_months: options.retentionMonths,
    label_sources: TRAINING_ELIGIBLE_LABEL_SOURCES,
    terms_versions: [...termsVersions].sort(),
    excluded: { cardsight_assisted: excludedCardSightAssisted, expired: excludedExpired, missing_bytes: missingBytes },
    cardsight_outputs_used: false,
    whatnot_content_used: false,
    live_scan_frames: false,
  };
  writeFileSync(path.join(options.outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { exported: lines.length, excludedCardSightAssisted, excludedExpired, missingBytes, outDir: options.outDir };
}
