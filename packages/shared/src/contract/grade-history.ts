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
});

export const gradeHistoryRoutes = {
  getGradeHistory: defineRoute({
    method: "GET",
    path: "/v1/inventory/:inventoryItemId/grade-history",
    bodyKind: "none",
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
