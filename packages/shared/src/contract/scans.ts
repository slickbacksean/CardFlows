/** Capture: create, read, confirm and reject scans. */
import { z } from "zod";
import { defineRoute } from "./core";
import { CanonicalCardSchema } from "./models";
import { ConfirmationRecordSchema, ScanRecordSchema } from "./records";

const ScanResponse = z.looseObject({ ok: z.literal(true), scan: ScanRecordSchema });

export const scanRoutes = {
  createScan: defineRoute({
    method: "POST",
    path: "/v1/scans",
    bodyKind: "json-or-form",
    body: z.object({ captureMethod: z.string(), scenario: z.string().optional() }),
    response: ScanResponse,
  }),
  getScan: defineRoute({
    method: "GET",
    path: "/v1/scans/:scanId",
    bodyKind: "none",
    response: ScanResponse,
  }),
  getScanImage: defineRoute({
    method: "GET",
    path: "/v1/scans/:scanId/image",
    bodyKind: "none",
    response: null,
  }),
  confirmScan: defineRoute({
    method: "POST",
    path: "/v1/scans/:scanId/confirm",
    bodyKind: "json",
    body: z.object({
      tcgdexId: z.string(),
      selectedVariant: z.string().nullable().optional(),
    }),
    response: z.looseObject({
      ok: z.literal(true),
      scan: ScanRecordSchema,
      confirmation: ConfirmationRecordSchema,
      canonicalCard: CanonicalCardSchema,
    }),
  }),
  rejectScan: defineRoute({
    method: "POST",
    path: "/v1/scans/:scanId/reject",
    bodyKind: "none",
    response: ScanResponse,
  }),
} as const;
