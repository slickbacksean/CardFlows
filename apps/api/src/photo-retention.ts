/**
 * Graded-photo retention (P0-07).
 *
 * Saved grade stills stay at most 30 days. Raw detect/pregrade uploads are
 * never this job's problem: they live in the in-memory upload cache and are
 * released when grading finishes. Account deletion calls `deleteUserPhotos`
 * and does not wait for this timer.
 */

export const GRADED_PHOTO_RETENTION_DAYS = 30;
export const GRADED_PHOTO_RETENTION_MS = GRADED_PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const PHOTO_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

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
