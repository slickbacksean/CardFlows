import { serve } from "@hono/node-server";
import { Hono } from "hono";

/**
 * Maintenance mode for DB restores (CARD_FLOW_MAINTENANCE=1, see docs/RESTORE_DRILL.md).
 * The entrypoint skips restore, migrate and Litestream and runs this instead. It never
 * opens the DB: /health answers 200 so the Railway deploy succeeds, everything else 503.
 */
export function createMaintenanceApp() {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true, service: "cardflow-api", maintenance: true }));
  app.all("*", (c) => {
    c.header("Retry-After", "300");
    return c.json({ ok: false, error: "maintenance", message: "PokeSniper is down for maintenance. Try again in a few minutes." }, 503);
  });
  return app;
}

const invokedDirectly = process.argv[1]?.endsWith("maintenance.ts");
if (invokedDirectly) {
  const parsedPort = Number(process.env.PORT);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3001;
  const server = serve({ fetch: createMaintenanceApp().fetch, port }, (info) => {
    console.log(`CardFlow API in maintenance mode on port ${info.port} (DB not opened)`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
