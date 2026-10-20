/**
 * Photo retention (P0-07, Sean Oct 19: photos are not stored).
 *
 * Scan and grade photos are deleted as soon as identification / the grade result is done
 * (app.ts). This hourly sweep is the safety net for failed or abandoned work: anything older
 * than 24 h goes (CARD_FLOW_SCAN_PHOTO_TTL_HOURS for scan stills). Raw detect/pregrade uploads are
 * never this job's problem: they live in the in-memory upload cache and are
 * released when grading finishes. Account deletion calls `deleteUserPhotos`
 * and does not wait for this timer.
 */

export const GRADED_PHOTO_RETENTION_HOURS = 24;
export const GRADED_PHOTO_RETENTION_MS = GRADED_PHOTO_RETENTION_HOURS * 60 * 60 * 1000;
export const PHOTO_RETENTION_INTERVAL_MS = 60 * 60 * 1000;

export const SCAN_PHOTO_TTL_HOURS = 24;

export function scanPhotoTtlHoursFromEnv(env: NodeJS.Dict<string | undefined> = process.env): number {
  const raw = env.CARD_FLOW_SCAN_PHOTO_TTL_HOURS?.trim();
  if (!raw) return SCAN_PHOTO_TTL_HOURS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : SCAN_PHOTO_TTL_HOURS;
}

export function isScanPhotoExpired(capturedAt: string, now: Date, ttlHours: number): boolean {
  const captured = Date.parse(capturedAt);
  if (!Number.isFinite(captured)) return true;
  return now.getTime() - captured >= ttlHours * 60 * 60 * 1000;
}

export interface GradePhotoObject {
  userId: string;
  inventoryItemId: string;
  side: "front" | "back";
  storageRef: string;
  createdAt: string;
}

export interface PhotoPurgeResult {
  deleted: number;
}

export function isGradePhotoExpired(createdAt: string, now: Date): boolean {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return true;
  return now.getTime() - created >= GRADED_PHOTO_RETENTION_MS;
}

export function startPhotoRetentionJob(options: {
  purge: (now: Date) => PhotoPurgeResult;
  now?: () => Date;
  intervalMs?: number;
  onPurge?: (result: PhotoPurgeResult) => void;
}): { stop: () => void; runOnce: () => PhotoPurgeResult } {
  const now = options.now ?? (() => new Date());
  const intervalMs = options.intervalMs ?? PHOTO_RETENTION_INTERVAL_MS;
  function runOnce(): PhotoPurgeResult {
    const result = options.purge(now());
    options.onPurge?.(result);
    return result;
  }
  runOnce();
  const timer = setInterval(runOnce, intervalMs);
  timer.unref?.();
  return {
    stop() {
      clearInterval(timer);
    },
    runOnce,
  };
}
