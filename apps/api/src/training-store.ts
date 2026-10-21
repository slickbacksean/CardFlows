/**
 * Sean (Oct 21): restricted training store for user-confirmed Scan a Card photos (PokeSniper's own
 * matcher only). Kept apart from scan photos: its own directory (0700, files 0600), no user IDs
 * (an HMAC of the user ID with the server pepper), provenance on every sample.
 *
 * TODO(R2): move sample bytes to a private R2 bucket once it exists. Until then this writes to the
 * API's data volume (next to the SQLite DB) and production keeps capture off
 * (CARD_FLOW_TRAINING_CAPTURE_ENABLED must be "true" explicitly).
 */
import { createHmac, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  isTrainingSampleExpired,
  trainingRetentionMonthsFromEnv,
  type TrainingLabelSource,
} from "@cardflow/shared";
import { serverPepper } from "./server-pepper";

import type { ScanImageMimeType } from "./scan-image";

export type TrainingImageMime = ScanImageMimeType;

export interface TrainingSampleMeta {
  sampleId: string;
  /** HMAC-SHA256(server pepper, user ID). Never the raw user ID. */
  userHash: string;
  tcgdexId: string;
  selectedVariant: string | null;
  labelSource: TrainingLabelSource;
  /** Recognition provider that produced the suggestions the user saw (provenance only). */
  recognitionProvider: string | null;
  termsVersion: string;
  capturedAt: string;
  source: "scan_a_card";
  /** Normalized 0–1 box of this card on the photo (multi-card scans), else null = whole photo. */
  cropBox: { x: number; y: number; width: number; height: number } | null;
  mimeType: TrainingImageMime;
  file: string;
}

export interface TrainingStore {
  isOptedOut(userId: string): boolean;
  setOptedOut(userId: string, optedOut: boolean): void;
  saveSample(input: Omit<TrainingSampleMeta, "sampleId" | "userHash" | "file"> & { userId: string; bytes: Uint8Array }): TrainingSampleMeta;
  deleteUserSamples(userId: string): number;
  /** Account deletion: samples and the opt-out record. */
  forgetUser(userId: string): number;
  purgeExpired(now: Date, months: number): number;
  listSamples(): TrainingSampleMeta[];
  readSampleBytes(meta: TrainingSampleMeta): Uint8Array | undefined;
  countUserSamples(userId: string): number;
}

export function trainingUserHash(userId: string, pepper: string = serverPepper()): string {
  return createHmac("sha256", pepper).update(`training:${userId}`).digest("hex");
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/** Filesystem store. `dir` holds samples/ (bytes + .json metadata) and optouts.json. */
export function createFsTrainingStore(dir: string, options: { pepper?: string } = {}): TrainingStore {
  const pepper = options.pepper ?? serverPepper();
  const hash = (userId: string) => trainingUserHash(userId, pepper);
  const samplesDir = path.join(dir, "samples");
  const optoutPath = path.join(dir, "optouts.json");
  mkdirSync(samplesDir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  chmodSync(samplesDir, 0o700);

  function readOptouts(): Set<string> {
    if (!existsSync(optoutPath)) return new Set();
    try {
      return new Set(JSON.parse(readFileSync(optoutPath, "utf8")) as string[]);
    } catch {
      return new Set();
    }
  }
  function writeOptouts(set: Set<string>) {
    const tmp = `${optoutPath}.tmp`;
    writeFileSync(tmp, JSON.stringify([...set]), { mode: 0o600 });
    renameSync(tmp, optoutPath);
  }
  function listSamples(): TrainingSampleMeta[] {
    if (!existsSync(samplesDir)) return [];
    const out: TrainingSampleMeta[] = [];
    for (const name of readdirSync(samplesDir)) {
      if (!name.endsWith(".json")) continue;
      try {
        out.push(JSON.parse(readFileSync(path.join(samplesDir, name), "utf8")) as TrainingSampleMeta);
      } catch {
        // half-written metadata: ignored (bytes without metadata are never exported)
      }
    }
    return out.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  }
  function remove(meta: TrainingSampleMeta) {
    for (const f of [path.join(samplesDir, meta.file), path.join(samplesDir, `${meta.sampleId}.json`)]) {
      if (existsSync(f)) unlinkSync(f);
    }
  }
  function deleteUserSamples(userId: string): number {
    const h = hash(userId);
    let n = 0;
    for (const meta of listSamples()) {
      if (meta.userHash !== h) continue;
      remove(meta);
      n += 1;
    }
    return n;
  }
  return {
    isOptedOut: (userId) => readOptouts().has(hash(userId)),
    setOptedOut(userId, optedOut) {
      const set = readOptouts();
      if (optedOut) set.add(hash(userId));
      else set.delete(hash(userId));
      writeOptouts(set);
    },
    saveSample(input) {
      const sampleId = randomUUID();
      const file = `${sampleId}.${EXT[input.mimeType] ?? "bin"}`;
      const { userId, bytes, ...rest } = input;
      const meta: TrainingSampleMeta = { ...rest, sampleId, userHash: hash(userId), file };
      writeFileSync(path.join(samplesDir, file), bytes, { mode: 0o600 });
      writeFileSync(path.join(samplesDir, `${sampleId}.json`), JSON.stringify(meta), { mode: 0o600 });
      return meta;
    },
    deleteUserSamples,
    forgetUser(userId) {
      const n = deleteUserSamples(userId);
      const set = readOptouts();
      if (set.delete(hash(userId))) writeOptouts(set);
      return n;
    },
    purgeExpired(now, months) {
      let n = 0;
      for (const meta of listSamples()) {
        if (!isTrainingSampleExpired(meta.capturedAt, now, months)) continue;
        remove(meta);
        n += 1;
      }
      return n;
    },
    listSamples,
    readSampleBytes(meta) {
      const f = path.join(samplesDir, path.basename(meta.file));
      return existsSync(f) ? new Uint8Array(readFileSync(f)) : undefined;
    },
    countUserSamples: (userId) => listSamples().filter((m) => m.userHash === hash(userId)).length,
  };
}

/** In-memory store (tests, memory API store). */
export function createMemoryTrainingStore(options: { pepper?: string } = {}): TrainingStore {
  const pepper = options.pepper ?? serverPepper();
  const hash = (userId: string) => trainingUserHash(userId, pepper);
  const optouts = new Set<string>();
  const samples = new Map<string, { meta: TrainingSampleMeta; bytes: Uint8Array }>();
  const deleteUserSamples = (userId: string) => {
    const h = hash(userId);
    let n = 0;
    for (const [id, s] of samples) if (s.meta.userHash === h) (samples.delete(id), (n += 1));
    return n;
  };
  return {
    isOptedOut: (userId) => optouts.has(hash(userId)),
    setOptedOut: (userId, optedOut) => void (optedOut ? optouts.add(hash(userId)) : optouts.delete(hash(userId))),
    saveSample(input) {
      const sampleId = randomUUID();
      const { userId, bytes, ...rest } = input;
      const meta: TrainingSampleMeta = { ...rest, sampleId, userHash: hash(userId), file: `${sampleId}.${EXT[input.mimeType] ?? "bin"}` };
      samples.set(sampleId, { meta, bytes: new Uint8Array(bytes) });
      return meta;
    },
    deleteUserSamples,
    forgetUser(userId) {
      optouts.delete(hash(userId));
      return deleteUserSamples(userId);
    },
    purgeExpired(now, months) {
      let n = 0;
      for (const [id, s] of samples) if (isTrainingSampleExpired(s.meta.capturedAt, now, months)) (samples.delete(id), (n += 1));
      return n;
    },
    listSamples: () => [...samples.values()].map((s) => s.meta),
    readSampleBytes: (meta) => samples.get(meta.sampleId)?.bytes,
    countUserSamples: (userId) => [...samples.values()].filter((s) => s.meta.userHash === hash(userId)).length,
  };
}

export interface TrainingCaptureConfig {
  enabled: boolean;
  retentionMonths: number;
  dir: string | null;
  reason: string;
}

/**
 * CARD_FLOW_TRAINING_CAPTURE_ENABLED: "true"/"false" wins. Unset = on outside production, OFF in
 * production (until the restricted storage, R2, is set up). CARD_FLOW_TRAINING_DIR overrides the
 * directory; default is `training/` next to the SQLite DB. No SQLite path = no capture.
 */
export function trainingCaptureConfigFromEnv(
  env: NodeJS.Dict<string | undefined> = process.env,
  sqlitePath: string | null = null,
): TrainingCaptureConfig {
  const retentionMonths = trainingRetentionMonthsFromEnv(env as Record<string, string | undefined>);
  const raw = env.CARD_FLOW_TRAINING_CAPTURE_ENABLED?.trim().toLowerCase();
  const flag = raw === "true" || raw === "1" ? true : raw === "false" || raw === "0" ? false : env.NODE_ENV !== "production";
  const dir = env.CARD_FLOW_TRAINING_DIR?.trim() || (sqlitePath ? path.join(path.dirname(sqlitePath), "training") : null);
  if (!flag) {
    return { enabled: false, retentionMonths, dir, reason: raw ? "CARD_FLOW_TRAINING_CAPTURE_ENABLED=false" : "off by default in production" };
  }
  if (!dir) return { enabled: false, retentionMonths, dir: null, reason: "no storage directory (memory store; set CARD_FLOW_TRAINING_DIR)" };
  return { enabled: true, retentionMonths, dir, reason: `on (${retentionMonths} month retention)` };
}
