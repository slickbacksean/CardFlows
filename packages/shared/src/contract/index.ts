/**
 * The CardFlow API contract (P1-01). One file per route group; `apiContract`
 * is the full registry the API checks against and the phone client calls.
 * Add a route here first, then register it on the API, then call it from
 * the phone through `callApi`.
 */
import { accountRoutes } from "./account";
import { catalogRoutes } from "./catalog";
import type { ApiRoute } from "./core";
import { gradeRoutes } from "./grade";
import { gradeHistoryRoutes } from "./grade-history";
import { gradingRoutes } from "./grading";
import { healthRoutes } from "./health";
import { inventoryRoutes } from "./inventory";
import { livestreamRoutes } from "./livestream";
import { metricsRoutes } from "./metrics";
import { salesRoutes } from "./sales";
import { scanRoutes } from "./scans";

export const apiContract = {
  ...healthRoutes,
  ...accountRoutes,
  ...catalogRoutes,
  ...scanRoutes,
  ...inventoryRoutes,
  ...gradeRoutes,
  ...gradingRoutes,
  ...livestreamRoutes,
  ...metricsRoutes,
  ...salesRoutes,
  ...gradeHistoryRoutes,
} as const;

export type ApiContract = typeof apiContract;
export type ApiRouteName = keyof ApiContract;

export const apiContractRoutes: readonly ApiRoute[] = Object.values(apiContract) as ApiRoute[];

export * from "./core";
export * from "./models";
export * from "./records";
export { CardSaleSchema, SaveSaleBodySchema, type CardSale } from "./sales";
export { GradeHistoryEntrySchema } from "./grade-history";
export type { CatalogSearchResponse } from "./catalog";
export { CatalogSearchResponseSchema } from "./catalog";
