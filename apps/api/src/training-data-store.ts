/**
 * Sean (Oct 25): Training data consent and retention for model improvement.
 * Consent via Terms acceptance (ON by default). Users can opt out via Settings toggle.
 * Training images: corrections, low-confidence, no-match. Kept 180 days or until used in training.
 */
import { createHmac } from "node:crypto";
import type { Database } from "better-sqlite3";
import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import {
  scanCorrectionFeedback,
  trainingDataOptOuts,
  trainingImages,
} from "./db/schema";

export const TRAINING_DATA_RETENTION_DAYS = 180;
export const TRAINING_IMAGE_DELETION_GRACE_DAYS = 30;

/** Environment variable for training data retention period in days. */
export function trainingDataRetentionDaysFromEnv(
  env: NodeJS.Dict<string | undefined> = process.env,
): number {
  const raw = env.CARD_FLOW_TRAINING_RETENTION_DAYS?.trim();
  if (!raw) return TRAINING_DATA_RETENTION_DAYS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : TRAINING_DATA_RETENTION_DAYS;
}

export type TrainingImageRetentionReason = "correction" | "low_confidence" | "no_match";

export interface TrainingImageRecord {
  imageId: string;
  userId: string;
  pseudonymousUserId: string;
  scanId: string;
  retentionReason: TrainingImageRetentionReason;
  capturedAt: string;
  storageRef: string;
  imageMimeType: string;
  expiresAt: string;
  termsVersion: string;
  usedInTrainingAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface ScanCorrectionRecord {
  feedbackId: string;
  pseudonymousUserId: string;
  scanId: string;
  chosenCardflowCardId: string;
  chosenTcgdexId: string;
  predictedTcgdexId: string | null;
  confidence: string | null;
  modelVersion: string;
  recognitionProvider: string;
  wasCorrection: boolean;
  createdAt: string;
  trainingImageId: string | null;
}

export interface TrainingDataStorePort {
  hasOptedOut(userId: string): boolean;
  optOut(userId: string): void;
  optIn(userId: string): void;
  saveTrainingImage(input: {
    userId: string;
    scanId: string;
    retentionReason: TrainingImageRetentionReason;
    capturedAt: string;
    storageRef: string;
    imageMimeType: string;
    termsVersion: string;
  }): TrainingImageRecord;
  saveCorrectionFeedback(input: {
    userId: string;
    scanId: string;
    chosenCardflowCardId: string;
    chosenTcgdexId: string;
    predictedTcgdexId: string | null;
    confidence: string | null;
    modelVersion: string;
    recognitionProvider: string;
    wasCorrection: boolean;
    trainingImageId?: string | null;
  }): ScanCorrectionRecord;
  deleteUserTrainingImages(userId: string): { deleted: number; storageRefs: string[] };
  purgeExpiredTrainingImages(now: Date): { deleted: number; storageRefs: string[] };
  physicallyDeleteTrainingImages(graceDays?: number): { deleted: number; storageRefs: string[] };
  markTrainingImageUsed(imageId: string): void;
}

export function createPseudonymousUserId(
  userId: string,
  pepper: string,
): string {
  return createHmac("sha256", pepper)
    .update(userId)
    .digest("hex")
    .slice(0, 32);
}

export function createTrainingDataStore(
  db: ReturnType<any>["db"],
  pepper: string,
): TrainingDataStorePort {
  function hasOptedOut(userId: string): boolean {
    const row = db
      .select()
      .from(trainingDataOptOuts)
      .where(eq(trainingDataOptOuts.userId, userId))
      .get();
    return Boolean(row);
  }

  function optOut(userId: string): void {
    db.insert(trainingDataOptOuts)
      .values({
        userId,
        optedOutAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .run();
  }

  function optIn(userId: string): void {
    db.delete(trainingDataOptOuts)
      .where(eq(trainingDataOptOuts.userId, userId))
      .run();
  }

  function saveTrainingImage(input: {
    userId: string;
    scanId: string;
    retentionReason: TrainingImageRetentionReason;
    capturedAt: string;
    storageRef: string;
    imageMimeType: string;
    termsVersion: string;
  }): TrainingImageRecord {
    const imageId = crypto.randomUUID();
    const pseudonymousUserId = createPseudonymousUserId(input.userId, pepper);
    const capturedMs = Date.parse(input.capturedAt);
    const retentionDays = trainingDataRetentionDaysFromEnv();
    const expiresAt = new Date(
      capturedMs + retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const createdAt = new Date().toISOString();

    const record: TrainingImageRecord = {
      imageId,
      userId: input.userId,
      pseudonymousUserId,
      scanId: input.scanId,
      retentionReason: input.retentionReason,
      capturedAt: input.capturedAt,
      storageRef: input.storageRef,
      imageMimeType: input.imageMimeType,
      expiresAt,
      termsVersion: input.termsVersion,
      usedInTrainingAt: null,
      deletedAt: null,
      createdAt,
    };

    db.insert(trainingImages).values(record).run();
    return record;
  }

  function saveCorrectionFeedback(input: {
    userId: string;
    scanId: string;
    chosenCardflowCardId: string;
    chosenTcgdexId: string;
    predictedTcgdexId: string | null;
    confidence: string | null;
    modelVersion: string;
    recognitionProvider: string;
    wasCorrection: boolean;
    trainingImageId?: string | null;
  }): ScanCorrectionRecord {
    const feedbackId = crypto.randomUUID();
    const pseudonymousUserId = createPseudonymousUserId(input.userId, pepper);
    const createdAt = new Date().toISOString();

    const record: ScanCorrectionRecord = {
      feedbackId,
      pseudonymousUserId,
      scanId: input.scanId,
      chosenCardflowCardId: input.chosenCardflowCardId,
      chosenTcgdexId: input.chosenTcgdexId,
      predictedTcgdexId: input.predictedTcgdexId,
      confidence: input.confidence,
      modelVersion: input.modelVersion,
      recognitionProvider: input.recognitionProvider,
      wasCorrection: input.wasCorrection,
      createdAt,
      trainingImageId: input.trainingImageId ?? null,
    };

    db.insert(scanCorrectionFeedback).values(record).run();
    return record;
  }

  function deleteUserTrainingImages(userId: string): { deleted: number } {
    const now = new Date().toISOString();
    
    // Get images before marking as deleted for physical file cleanup
    const imagesToDelete = db
      .select()
      .from(trainingImages)
      .where(
        and(
          eq(trainingImages.userId, userId),
          isNull(trainingImages.deletedAt),
        ),
      )
      .all();
    
    const result = db
      .update(trainingImages)
      .set({ deletedAt: now })
      .where(
        and(
          eq(trainingImages.userId, userId),
          isNull(trainingImages.deletedAt),
        ),
      )
      .run();
    
    return { deleted: result.changes, storageRefs: imagesToDelete.map((img) => img.storageRef) };
  }

  function purgeExpiredTrainingImages(now: Date): { deleted: number; storageRefs: string[] } {
    const nowIso = now.toISOString();
    
    // Get images before marking as deleted for physical file cleanup
    const imagesToDelete = db
      .select()
      .from(trainingImages)
      .where(
        and(
          isNull(trainingImages.deletedAt),
          lte(trainingImages.expiresAt, nowIso),
        ),
      )
      .all();
    
    const result = db
      .update(trainingImages)
      .set({ deletedAt: nowIso })
      .where(
        and(
          isNull(trainingImages.deletedAt),
          lte(trainingImages.expiresAt, nowIso),
        ),
      )
      .run();
    
    return { deleted: result.changes, storageRefs: imagesToDelete.map((img) => img.storageRef) };
  }

  function physicallyDeleteTrainingImages(graceDays: number = 30): { deleted: number; storageRefs: string[] } {
    const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000).toISOString();
    
    const imagesToPhysicallyDelete = db
      .select()
      .from(trainingImages)
      .where(
        and(
          isNotNull(trainingImages.deletedAt),
          lte(trainingImages.deletedAt, cutoff),
        ),
      )
      .all();
    
    let deleted = 0;
    for (const image of imagesToPhysicallyDelete) {
      // Physical file deletion is handled by the caller
      deleted++;
    }
    
    // Remove database records
    db.delete(trainingImages)
      .where(
        and(
          isNotNull(trainingImages.deletedAt),
          lte(trainingImages.deletedAt, cutoff),
        ),
      )
      .run();
    
    return { deleted, storageRefs: imagesToPhysicallyDelete.map((img) => img.storageRef) };
  }

  function markTrainingImageUsed(imageId: string): void {
    const now = new Date().toISOString();
    db.update(trainingImages)
      .set({ usedInTrainingAt: now })
      .where(eq(trainingImages.imageId, imageId))
      .run();
  }

  return {
    hasOptedOut,
    optOut,
    optIn,
    saveTrainingImage,
    saveCorrectionFeedback,
    deleteUserTrainingImages,
    purgeExpiredTrainingImages,
    physicallyDeleteTrainingImages,
    markTrainingImageUsed,
  };
}
