/**
 * Sean (Oct 25): Training data opt-out API routes.
 */
import { z } from "zod";
import { defineRoute } from "./core";

export const trainingDataRoutes = {
  getTrainingDataStatus: defineRoute({
    method: "GET",
    path: "/v1/training-data/status",
    response: z.object({
      ok: z.literal(true),
      optedOut: z.boolean(),
    }),
  }),
  optOutOfTrainingData: defineRoute({
    method: "POST",
    path: "/v1/training-data/opt-out",
    bodyKind: "empty",
    response: z.object({ ok: z.literal(true) }),
  }),
  optInToTrainingData: defineRoute({
    method: "POST",
    path: "/v1/training-data/opt-in",
    bodyKind: "empty",
    response: z.object({ ok: z.literal(true) }),
  }),
} as const;
