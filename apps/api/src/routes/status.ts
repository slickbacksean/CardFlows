/** P1-21 status banners. Contract: `statusRoutes`. Cached briefly so polling stays cheap. */
import { statusBanners, type StatusInputs } from "@cardflow/shared";
import type { CardFlowApp } from "../app-env";

export interface StatusRouteDeps {
  inputs(): Promise<StatusInputs>;
  cacheMs?: number;
  now?: () => number;
}

export function registerStatusRoutes(app: CardFlowApp, deps: StatusRouteDeps): void {
  const cacheMs = deps.cacheMs ?? 30_000;
  const now = deps.now ?? (() => Date.now());
  let cached: { at: number; body: { ok: true; banners: ReturnType<typeof statusBanners>; checkedAt: string } } | null = null;

  app.get("/v1/status", async (c) => {
    if (!cached || now() - cached.at >= cacheMs) {
      const banners = statusBanners(await deps.inputs());
      cached = { at: now(), body: { ok: true, banners, checkedAt: new Date(now()).toISOString() } };
    }
    return c.json(cached.body);
  });
}
