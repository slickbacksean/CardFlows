/** P1-07 async pre-grade jobs. */
import { z } from "zod";
import { defineRoute } from "./core";

export const GradeJobSchema = z.looseObject({
  jobId: z.string(),
  status: z.enum(["queued", "running", "waiting", "done", "failed"]),
  retryAfterSeconds: z.number().nullable(),
  estimate: z.looseObject({}).nullable(),
  error: z.string().nullable(),
  requestId: z.string().nullable(),
});

export const gradeJobRoutes = {
  createGradeJob: defineRoute({
    method: "POST",
    path: "/v1/inventory/:inventoryItemId/grade-jobs",
    bodyKind: "json-or-form",
    body: z.object({ reestimate: z.boolean().optional() }),
    response: z.looseObject({ ok: z.literal(true), job: GradeJobSchema }),
  }),
  getGradeJob: defineRoute({
    method: "GET",
    path: "/v1/grade-jobs/:jobId",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), job: GradeJobSchema }),
  }),
} as const;
