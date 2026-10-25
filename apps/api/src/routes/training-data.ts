/**
 * Sean (Oct 25): Training data opt-out API routes. By accepting Terms, users consent to training
 * data retention (ON by default). This endpoint lets users opt out via Settings toggle.
 */
import type { CardFlowApp } from "../app-env";
import type { TrainingDataStorePort } from "../training-data-store";

export interface TrainingDataRouteDeps {
  trainingData: TrainingDataStorePort;
}

export function registerTrainingDataRoutes(
  app: CardFlowApp,
  deps: TrainingDataRouteDeps,
): void {
  const { trainingData } = deps;

  app.get("/v1/training-data/status", (c) => {
    const userId = c.get("userId");
    const optedOut = trainingData.hasOptedOut(userId);
    return c.json({ ok: true, optedOut });
  });

  app.post("/v1/training-data/opt-out", (c) => {
    const userId = c.get("userId");
    trainingData.optOut(userId);
    trainingData.deleteUserTrainingImages(userId);
    return c.json({ ok: true });
  });

  app.post("/v1/training-data/opt-in", (c) => {
    const userId = c.get("userId");
    trainingData.optIn(userId);
    return c.json({ ok: true });
  });
}
