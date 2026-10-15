import { defineRoute } from "./core";
import { HealthSchema } from "./models";

export const healthRoutes = {
  getHealth: defineRoute({
    method: "GET",
    path: "/health",
    bodyKind: "none",
    response: HealthSchema,
    errorResponse: HealthSchema,
  }),
} as const;
