/**
 * Sean (Oct 25): Training data retention job. Purges expired training images and physically
 * deletes soft-deleted images after grace period (30 days).
 */
import { unlinkSync, existsSync } from "node:fs";
import path from "path";
import type { TrainingDataStorePort } from "./training-data-store";

export const TRAINING_DATA_PURGE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
export const PHYSICAL_DELETION_GRACE_DAYS = 30;

export interface TrainingDataPurgeResult {
  expiredDeleted: number;
  physicallyDeleted: number;
  filesDeleted: number;
}

export function startTrainingDataRetentionJob(options: {
  trainingDataStore: TrainingDataStorePort;
  storageDir: string | null;
  now?: () => Date;
  intervalMs?: number;
  graceDays?: number;
  onPurge?: (result: TrainingDataPurgeResult) => void;
}): { stop: () => void; runOnce: () => TrainingDataPurgeResult } {
  const now = options.now ?? (() => new Date());
  const intervalMs = options.intervalMs ?? TRAINING_DATA_PURGE_INTERVAL_MS;
  const graceDays = options.graceDays ?? PHYSICAL_DELETION_GRACE_DAYS;

  function runOnce(): TrainingDataPurgeResult {
    const { trainingDataStore, storageDir } = options;

    // Step 1: Mark expired images as deleted (soft delete)
    const expiredResult = trainingDataStore.purgeExpiredTrainingImages(now());

    // Step 2: Physically delete images that have been soft-deleted for > grace period
    const physicalResult = trainingDataStore.physicallyDeleteTrainingImages(graceDays);

    // Step 3: Delete physical files
    let filesDeleted = 0;
    if (storageDir) {
      for (const storageRef of physicalResult.storageRefs) {
        const filePath = path.join(storageDir, storageRef);
        if (existsSync(filePath)) {
          try {
            unlinkSync(filePath);
            filesDeleted++;
          } catch (err) {
            console.error(`Failed to delete training image file ${filePath}:`, err);
          }
        }
      }
    }

    const result: TrainingDataPurgeResult = {
      expiredDeleted: expiredResult.deleted,
      physicallyDeleted: physicalResult.deleted,
      filesDeleted,
    };

    options.onPurge?.(result);
    return result;
  }

  // Run once on startup
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
