/** P1-27 mapping-quality report (aggregates only). `format=markdown` answers text. */
import { z } from "zod";
import { defineRoute } from "./core";

export const metricsRoutes = {
  getMappingMetrics: defineRoute({
    method: "GET",
    path: "/v1/metrics/mapping",
    bodyKind: "none",
    query: z.object({ days: z.string().optional(), format: z.string().optional() }),
    // JSON `{ ok, report }` or markdown text, so the body is not schema-checked.
    response: null,
  }),
  /** P1-17 ops metrics; bearer token required (404 when unset). */
  getOpsMetrics: defineRoute({
    method: "GET",
    path: "/ops/metrics",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true) }),
  }),
} as const;
