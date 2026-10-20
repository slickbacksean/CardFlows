import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GRADED_PHOTO_RETENTION_MS } from "./photo-retention";
import { decodeScanStill } from "./obb-phash-decode";
import type { GradeExtraShot, GradeSide } from "@cardflow/shared";

/**
 * Full 14-photo extras: tilted + corner close-ups, linked to a grade session id,
 * blur-checked on the server, kept ≤ 30 days like graded photos.
 *   <dataDir>/grade/extras/<userId>/<sessionId>/meta.json
 *   <dataDir>/grade/extras/<userId>/<sessionId>/<side>-<shot>.jpg
 */

const API_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
/** Pre-fix location (not on the Railway volume). Still swept so old local files get cleaned up. */
const LEGACY_EXTRA_DIR = path.join(API_DATA_DIR, "grade-extras");

/**
 * Dev Ops (Oct 19): extras live next to the DB on the data volume, under `<dataDir>/grade/extras`
 * (`/data/grade/extras` on Railway), so they survive redeploys. The data dir is the folder of
 * CARD_FLOW_SQLITE_PATH, the same rule the SQLite store uses for scan and grade photos.
 */
export function gradeExtrasDir(env: NodeJS.Dict<string | undefined> = process.env): string {
  const raw = env.CARD_FLOW_SQLITE_PATH?.trim();
  if (!raw || raw === ":memory:") return path.join(API_DATA_DIR, "grade", "extras");
  const db = path.isAbsolute(raw) ? raw : path.resolve(raw);
  return path.join(path.dirname(db), "grade", "extras");
}

function extraRoots(): string[] {
  const current = gradeExtrasDir();
  return current === LEGACY_EXTRA_DIR ? [current] : [current, LEGACY_EXTRA_DIR];
}

export const MIN_EXTRA_SHARPNESS = 60;
export const GRADE_SESSION_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

export function isGradeSessionId(value: unknown): value is string {
  return typeof value === "string" && GRADE_SESSION_ID_RE.test(value);
}

function safeUser(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function sessionDir(userId: string, sessionId: string): string {
  return path.join(gradeExtrasDir(), safeUser(userId), sessionId);
}

export interface GradeExtraMeta {
  userId: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExtraBlurResult {
  ok: boolean;
  sharpness: number | null;
  reason?: string;
}

export function laplacianVarianceRgb(data: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  const long = Math.max(width, height);
  const scale = long > 160 ? 160 / long : 1;
  const w = Math.max(3, Math.round(width * scale));
  const h = Math.max(3, Math.round(height * scale));
  const gray = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const i = (sy * width + sx) * 3;
      gray[y * w + x] = 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
    }
  }
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = gray[y * w + x] ?? 0;
      const lap =
        (gray[(y - 1) * w + x] ?? 0) +
        (gray[(y + 1) * w + x] ?? 0) +
        (gray[y * w + (x - 1)] ?? 0) +
        (gray[y * w + (x + 1)] ?? 0) -
        4 * c;
      sum += lap;
      sumSq += lap * lap;
      n += 1;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.round((sumSq / n - mean * mean) * 10) / 10;
}

export async function checkExtraBlur(still: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<ExtraBlurResult> {
  try {
    if (still.mimeType !== "image/jpeg" && still.mimeType !== "image/png" && still.mimeType !== "image/webp") {
      return { ok: false, sharpness: null, reason: "Couldn't read the photo" };
    }
    if (still.mimeType === "image/webp") return { ok: true, sharpness: null };
    const bitmap = await decodeScanStill(still.bytes, still.mimeType);
    if (!bitmap) return { ok: false, sharpness: null, reason: "Couldn't read the photo" };
    const sharpness = laplacianVarianceRgb(bitmap.data, bitmap.width, bitmap.height);
    if (sharpness < MIN_EXTRA_SHARPNESS) {
      return { ok: false, sharpness, reason: "Too blurry. Move back a little and retake." };
    }
    return { ok: true, sharpness };
  } catch {
    return { ok: false, sharpness: null, reason: "Couldn't read the photo" };
  }
}

function writeMeta(dir: string, meta: GradeExtraMeta): void {
  writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
}

function readMeta(dir: string): GradeExtraMeta | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8")) as GradeExtraMeta;
    if (!raw?.sessionId || !raw?.createdAt) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveGradeExtraShot(input: {
  userId: string;
  sessionId: string;
  side: GradeSide | string;
  shot: GradeExtraShot | string;
  still: { bytes: Uint8Array; mimeType: string };
  now?: Date;
}): boolean {
  if (!isGradeSessionId(input.sessionId)) return false;
  try {
    const dir = sessionDir(input.userId, input.sessionId);
    mkdirSync(dir, { recursive: true });
    const now = (input.now ?? new Date()).toISOString();
    const existing = readMeta(dir);
    writeMeta(dir, {
      userId: input.userId,
      sessionId: input.sessionId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    const ext =
      input.still.mimeType === "image/png" ? ".png" : input.still.mimeType === "image/webp" ? ".webp" : ".jpg";
    writeFileSync(path.join(dir, `${input.side}-${input.shot}${ext}`), input.still.bytes);
    return true;
  } catch {
    return false;
  }
}

export function gradeExtrasSessionPath(userId: string, sessionId: string): string | null {
  if (!isGradeSessionId(sessionId)) return null;
  const dir = sessionDir(userId, sessionId);
  return existsSync(dir) ? dir : null;
}

export function deleteUserGradeExtras(userId: string): number {
  let deleted = 0;
  for (const root of extraRoots()) {
    const rootDir = path.join(root, safeUser(userId));
    if (!existsSync(rootDir)) continue;
    try {
      for (const session of readdirSync(rootDir)) {
        const dir = path.join(rootDir, session);
        try {
          deleted += readdirSync(dir).filter((n) => n !== "meta.json").length;
          rmSync(dir, { recursive: true, force: true });
        } catch { /* continue */ }
      }
      rmSync(rootDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
  return deleted;
}

export function purgeExpiredGradeExtras(now: Date = new Date()): { deleted: number } {
  let deleted = 0;
  const cutoff = now.getTime() - GRADED_PHOTO_RETENTION_MS;
  for (const root of extraRoots()) {
    if (!existsSync(root)) continue;
    for (const user of readdirSync(root)) {
      const userRoot = path.join(root, user);
      try {
        if (!statSync(userRoot).isDirectory()) continue;
      } catch { continue; }
      for (const session of readdirSync(userRoot)) {
        const dir = path.join(userRoot, session);
        const meta = readMeta(dir);
        let created = meta ? Date.parse(meta.createdAt) : NaN;
        if (!Number.isFinite(created)) {
          try { created = statSync(dir).mtimeMs; } catch { created = 0; }
        }
        if (created > cutoff) continue;
        try {
          deleted += readdirSync(dir).filter((n) => n !== "meta.json").length;
          rmSync(dir, { recursive: true, force: true });
        } catch { /* continue */ }
      }
    }
  }
  return { deleted };
}

export function gradeExtrasRootForTests(): string {
  return gradeExtrasDir();
}

/** Sean (Oct 19): angled extras are deleted as soon as the grade result is back. */
export function deleteGradeExtrasSession(userId: string, sessionId: string): number {
  if (!isGradeSessionId(sessionId)) return 0;
  let deleted = 0;
  for (const root of extraRoots()) {
    const dir = path.join(root, safeUser(userId), sessionId);
    if (!existsSync(dir)) continue;
    try {
      deleted += readdirSync(dir).filter((n) => n !== "meta.json").length;
      rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
  return deleted;
}
