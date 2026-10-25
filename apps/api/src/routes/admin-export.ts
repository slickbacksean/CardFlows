/**
 * Sean (Oct 25): Admin export endpoint for training data corrections and images.
 * Admin-only access. Returns JSON with correction feedback records and training image metadata.
 */
import { desc, eq, isNull } from "drizzle-orm";
import type { CardFlowApp } from "../app-env";
import { scanCorrectionFeedback, trainingImages } from "../db/schema";
import type { SqliteStorePort } from "../sqlite-store";

export interface AdminExportRouteDeps {
  store: SqliteStorePort;
  isAdmin: (userId: string) => boolean;
}

export function registerAdminExportRoutes(
  app: CardFlowApp,
  deps: AdminExportRouteDeps,
): void {
  const { store, isAdmin } = deps;

  app.get("/v1/admin/training-data/export", (c) => {
    const userId = c.get("userId");
    
    if (!isAdmin(userId)) {
      return c.json({ ok: false, error: "Admin access required" }, 403);
    }

    const corrections = store.db
      .select()
      .from(scanCorrectionFeedback)
      .orderBy(desc(scanCorrectionFeedback.createdAt))
      .all();

    const images = store.db
      .select()
      .from(trainingImages)
      .where(isNull(trainingImages.deletedAt))
      .orderBy(desc(trainingImages.createdAt))
      .all();

    return c.json({
      ok: true,
      corrections,
      images,
      stats: {
        totalCorrections: corrections.length,
        totalImages: images.length,
        imagesByReason: {
          correction: images.filter((img) => img.retentionReason === "correction").length,
          lowConfidence: images.filter((img) => img.retentionReason === "low_confidence").length,
          noMatch: images.filter((img) => img.retentionReason === "no_match").length,
        },
      },
    });
  });

  app.get("/v1/admin/training-data/corrections/:feedbackId", (c) => {
    const userId = c.get("userId");
    const feedbackId = c.req.param("feedbackId");
    
    if (!isAdmin(userId)) {
      return c.json({ ok: false, error: "Admin access required" }, 403);
    }

    const correction = store.db
      .select()
      .from(scanCorrectionFeedback)
      .where(eq(scanCorrectionFeedback.feedbackId, feedbackId))
      .get();

    if (!correction) {
      return c.json({ ok: false, error: "Correction not found" }, 404);
    }

    let trainingImage = null;
    if (correction.trainingImageId) {
      trainingImage = store.db
        .select()
        .from(trainingImages)
        .where(eq(trainingImages.imageId, correction.trainingImageId))
        .get();
    }

    return c.json({
      ok: true,
      correction,
      trainingImage,
    });
  });
}
