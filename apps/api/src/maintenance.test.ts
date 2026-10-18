import { describe, expect, it } from "vitest";
import { createMaintenanceApp } from "./maintenance";

describe("maintenance mode", () => {
  it("answers /health 200 and every other route 503 with Retry-After", async () => {
    const app = createMaintenanceApp();
    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, maintenance: true });
    const other = await app.request("/v1/scans", { method: "POST" });
    expect(other.status).toBe(503);
    expect(other.headers.get("Retry-After")).toBe("300");
    expect(await other.json()).toMatchObject({ error: "maintenance" });
  });
});
