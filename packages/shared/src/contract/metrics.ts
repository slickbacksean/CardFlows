/** P1-27 mapping-quality report (aggregates only). `format=markdown` answers text. */
import { z } from "zod";
import type { PerfBatch } from "../perf-telemetry";
import { defineRoute, typed } from "./core";

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
  /** D10 / P1-20 North Star by ISO week; same bearer token as /ops/metrics. */
  getNorthStar: defineRoute({
    method: "GET",
    path: "/ops/north-star",
    bodyKind: "none",
    query: z.object({ weeks: z.string().optional() }),
    response: z.looseObject({ ok: z.literal(true), metric: z.string(), weeks: z.array(z.looseObject({})) }),
  }),
  /**
   * Policy Reviewer (Oct 17): under-18 report. Same bearer token as /ops/metrics (404 when unset).
   * Turns CardSight off and deletes the account and all its data.
   */
  postUnder18Report: defineRoute({
    method: "POST",
    path: "/ops/under-18-report",
    bodyKind: "json",
    body: z.object({ email: z.string().optional(), userId: z.string().optional() }),
    response: z.object({
      ok: z.literal(true),
      cardSightOff: z.boolean(),
      photosDeleted: z.number(),
      rowsDeleted: z.number(),
    }),
  }),
  /** P1-18 sampled on-device timings (no images). */
  postPerfTelemetry: defineRoute({
    method: "POST",
    path: "/v1/telemetry/perf",
    bodyKind: "json",
    body: typed<PerfBatch>(z.object({ samples: z.array(z.unknown()) })),
    response: z.looseObject({ ok: z.literal(true), accepted: z.number() }),
  }),
} as const;
