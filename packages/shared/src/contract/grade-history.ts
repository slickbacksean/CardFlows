/** P2-07 per-card pre-grade estimate history. Estimates only, never an official grade. */
import { z } from "zod";
import { defineRoute } from "./core";

export const GradeHistoryEntrySchema = z.looseObject({
  at: z.string(),
  overall: z.number(),
  confidence: z.string().nullable(),
});

const HistoryResponse = z.looseObject({
  ok: z.literal(true),
  history: z.array(GradeHistoryEntrySchema),
  /** Free accounts: older estimates kept on the server but not shown until upgrade. */
  lockedCount: z.number().optional(),
  /** Premium: pass as `before` to get the next older page; null when there is none. */
  nextCursor: z.string().nullable().optional(),
});

export const gradeHistoryRoutes = {
  /** D14: premium check only (it runs nothing). 403 premium_required for free accounts. */
  startGradeBatch: defineRoute({
    method: "POST",
    path: "/v1/grading/batch",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), plan: z.literal("premium") }),
  }),
  getGradeHistory: defineRoute({
    method: "GET",
    path: "/v1/inventory/:inventoryItemId/grade-history",
    bodyKind: "none",
    query: z.looseObject({ before: z.string().optional(), limit: z.string().optional() }),
    response: HistoryResponse,
  }),
  /** One-time upload of entries kept on the phone before server history. */
  importGradeHistory: defineRoute({
    method: "POST",
    path: "/v1/inventory/:inventoryItemId/grade-history",
    bodyKind: "json",
    body: z.object({
      entries: z.array(
        z.object({ at: z.string(), overall: z.number(), confidence: z.string().nullable().optional() }),
      ),
    }),
    response: z.looseObject({ ok: z.literal(true), imported: z.number(), history: z.array(GradeHistoryEntrySchema) }),
  }),
} as const;
