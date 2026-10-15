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
} as const;
