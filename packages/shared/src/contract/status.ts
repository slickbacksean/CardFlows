/** P1-21 server-driven status banners. */
import { z } from "zod";
import { defineRoute } from "./core";

export const StatusBannerSchema = z.looseObject({
  id: z.string(),
  message: z.string(),
  severity: z.enum(["info", "warning"]),
});

export const statusRoutes = {
  getStatus: defineRoute({
    method: "GET",
    path: "/v1/status",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), banners: z.array(StatusBannerSchema), checkedAt: z.string() }),
  }),
} as const;
