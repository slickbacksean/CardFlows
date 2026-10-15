/** Sent-to-grader and returned copies. */
import { z } from "zod";
import { defineRoute } from "./core";
import { GradingReturnedCopySchema, GradingSubmittedCopySchema } from "./models";

const Submitted = z.array(GradingSubmittedCopySchema);
const Returned = z.array(GradingReturnedCopySchema);
const optText = z.string().nullable().optional();

export const gradingRoutes = {
  listGrading: defineRoute({
    method: "GET",
    path: "/v1/grading",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), submitted: Submitted, returned: Returned }),
  }),
  submitGradingCopy: defineRoute({
    method: "POST",
    path: "/v1/grading/submitted",
    bodyKind: "json",
    body: z.object({
      intent: z.enum(["purchased", "watchlist"]).optional(),
      inventoryItemId: z.string(),
      name: z.string(),
      localId: optText,
      imageUrl: optText,
      condition: optText,
      pillarAnswers: z.record(z.string(), z.string()).optional(),
      serviceLevelNote: z.string().optional(),
      maxBuyAmount: optText,
      estimateJson: optText,
    }),
    response: z.looseObject({ ok: z.literal(true), submitted: Submitted }),
  }),
  patchGradingSubmitted: defineRoute({
    method: "PATCH",
    path: "/v1/grading/submitted/:inventoryItemId",
    bodyKind: "json",
    body: z.object({
      orderNumber: z.string().optional(),
      company: z.string().optional(),
      status: z.enum(["sent", "at_grader"]).optional(),
    }),
    response: z.looseObject({ ok: z.literal(true), submitted: Submitted }),
  }),
  markGradingReturned: defineRoute({
    method: "POST",
    path: "/v1/grading/returned",
    bodyKind: "json",
    body: z.object({
      inventoryItemId: z.string(),
      certNumber: z.string().optional(),
      returnedGrade: z.string().optional(),
    }),
    response: z.looseObject({ ok: z.literal(true), submitted: Submitted, returned: Returned }),
  }),
  patchGradingReturned: defineRoute({
    method: "PATCH",
    path: "/v1/grading/returned/:inventoryItemId",
    bodyKind: "json",
    body: z.object({
      certNumber: z.string().optional(),
      returnedGrade: z.string().optional(),
    }),
    response: z.looseObject({ ok: z.literal(true), returned: Returned }),
  }),
} as const;
