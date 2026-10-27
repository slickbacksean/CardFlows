/**
 * Sean (Oct 25): Training data opt-out API routes. By accepting Terms, users consent to training
 * data retention (ON by default). This endpoint lets users opt out via Settings toggle.
 */
import { unlinkSync, existsSync } from "node:fs";
import path from "path";
import type { CardFlowApp } from "../app-env";
import type { TrainingDataStorePort } from "../training-data-store";

export interface TrainingDataRouteDeps {
  trainingData: TrainingDataStorePort;
  storageDir: string | null;
}

export function registerTrainingDataRoutes(
  app: CardFlowApp,
  deps: TrainingDataRouteDeps,
): void {
  const { trainingData, storageDir } = deps;

  app.get("/v1/training-data/status", (c) => {
    const userId = c.get("userId");
    const optedOut = trainingData.hasOptedOut(userId);
    return c.json({ ok: true, optedOut });
  });

  app.post("/v1/training-data/opt-out", (c) => {
    const userId = c.get("userId");
    trainingData.optOut(userId);
    
    // Delete user's training images (soft delete - physical deletion after 30 days)
    const result = trainingData.deleteUserTrainingImages(userId);
    
    // Optionally delete files immediately on opt-out (or wait for scheduled purge)
    // For now, files are deleted by the scheduled job after 30 days
    
    return c.json({ ok: true, imagesMarkedForDeletion: result.deleted });
  });

  app.post("/v1/training-data/opt-in", (c) => {
    const userId = c.get("userId");
    trainingData.optIn(userId);
    return c.json({ ok: true });
  });
}
