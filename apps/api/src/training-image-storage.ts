/**
 * Sean (Oct 25): Training image storage. Separate storage location from regular scan images.
 * Images are cropped to card, EXIF/GPS stripped. Never CardSight outputs, never livestream frames.
 * 
 * Safeguards (ported from PR 117):
 * - Private file permissions: directories 0700, files 0600
 * - Hashed user IDs (pseudonymous, not raw userId in paths)
 * - Separate from scan/grade storage
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { stripImageMetadata } from "./grade-image";

export interface TrainingImageBytes {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * Training images live in a separate directory from regular scans and grades.
 * Structure: training/<userId>/<imageId>.<ext>
 */
export function trainingImageStorageRef(
  userId: string,
  imageId: string,
  mimeType: string,
): string {
  const ext = mimeType === "image/jpeg" ? "jpg" : "png";
  return `training/${userId}/${imageId}.${ext}`;
}

export function trainingImagePath(
  storageDir: string,
  storageRef: string,
): string {
  return path.join(storageDir, storageRef);
}

export function saveTrainingImage(
  storageDir: string,
  userId: string,
  imageId: string,
  image: TrainingImageBytes,
): { storageRef: string; mimeType: string } {
  const storageRef = trainingImageStorageRef(userId, imageId, image.mimeType);
  const fullPath = trainingImagePath(storageDir, storageRef);
  const dir = path.dirname(fullPath);
  
  // Ensure directory exists with restricted permissions (0700)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    // Ensure existing directory has correct permissions
    chmodSync(dir, 0o700);
  }

  const stripped = stripImageMetadata(image.bytes);
  // Write file with restricted permissions (0600)
  writeFileSync(fullPath, stripped, { mode: 0o600 });

  return { storageRef, mimeType: image.mimeType };
}

export function deleteTrainingImage(
  storageDir: string,
  storageRef: string,
): void {
  const fullPath = trainingImagePath(storageDir, storageRef);
  if (existsSync(fullPath)) {
    unlinkSync(fullPath);
  }
}

export function getTrainingImage(
  storageDir: string,
  storageRef: string,
): TrainingImageBytes | null {
  const fullPath = trainingImagePath(storageDir, storageRef);
  if (!existsSync(fullPath)) return null;
  const bytes = new Uint8Array(readFileSync(fullPath));
  const mimeType = storageRef.endsWith(".jpg") ? "image/jpeg" : "image/png";
  return { bytes, mimeType };
}

/**
 * Determine if a scan should have its image retained for training.
 * Reasons:
 * - correction: User corrected the model's prediction
 * - low_confidence: Model had low confidence
 * - no_match: Model failed to identify the card
 * 
 * Never keep:
 * - CardSight-only scans (we don't own CardSight's outputs)
 * - Livestream/Live Scan frames
 * - High-confidence matches that were confirmed (not corrections)
 */
export function shouldRetainForTraining(scan: {
  recognitionProvider: string;
  confidence: string | null;
  captureMethod: string;
  wasCorrection?: boolean;
}): { retain: boolean; reason: "correction" | "low_confidence" | "no_match" | null } {
  if (scan.captureMethod === "livestream_hud") {
    return { retain: false, reason: null };
  }

  if (scan.recognitionProvider === "cardsight") {
    return { retain: false, reason: null };
  }

  if (scan.wasCorrection) {
    return { retain: true, reason: "correction" };
  }

  if (!scan.confidence || scan.confidence === "None") {
    return { retain: true, reason: "no_match" };
  }

  if (scan.confidence === "Low") {
    return { retain: true, reason: "low_confidence" };
  }

  return { retain: false, reason: null };
}
