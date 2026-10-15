/** Pre-grade estimates, photo detect, monthly quota and extra credits. */
import { z } from "zod";
import { defineRoute } from "./core";
import {
  DetectCropResultSchema,
  GradeEstimateSchema,
  GradeQuotaSnapshotSchema,
  PhotoPregradeResultSchema,
} from "./models";

const QuotaResponse = z.looseObject({ ok: z.literal(true), quota: GradeQuotaSnapshotSchema });

export const gradeRoutes = {
  getGradeQuota: defineRoute({
    method: "GET",
    path: "/v1/grade/quota",
    bodyKind: "none",
    response: QuotaResponse,
  }),
  consumeGradeCredits: defineRoute({
    method: "POST",
    path: "/v1/grade/credits/consume",
    bodyKind: "json",
    body: z.object({ count: z.number().optional() }),
    response: QuotaResponse,
  }),
  grantGradeCredits: defineRoute({
    method: "POST",
    path: "/v1/grade/credits",
    bodyKind: "json",
    body: z.object({
      credits: z.number().optional(),
      plan: z.enum(["free", "premium"]).optional(),
    }),
    response: QuotaResponse,
  }),
  detectGradePhoto: defineRoute({
    method: "POST",
    path: "/v1/grade/detect",
    bodyKind: "form",
    response: DetectCropResultSchema,
  }),
  requestPhotoPregrade: defineRoute({
    method: "POST",
    path: "/v1/grade/pregrade",
    bodyKind: "form",
    response: PhotoPregradeResultSchema,
  }),
  requestGradeEstimate: defineRoute({
    method: "POST",
    path: "/v1/inventory/:inventoryItemId/grade-estimate",
    bodyKind: "json-or-form",
    body: z.object({ reestimate: z.boolean().optional() }),
    response: z.looseObject({ ok: z.literal(true), estimate: GradeEstimateSchema }),
  }),
  getGradePhoto: defineRoute({
    method: "GET",
    path: "/v1/inventory/:inventoryItemId/grade-photos/:side",
    bodyKind: "none",
    response: null,
  }),
} as const;
