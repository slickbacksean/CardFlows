import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createMemoryStore } from "./store";

async function purchase(app: ReturnType<typeof createApp>) {
  const scan = (await (
    await app.request("/v1/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    })
  ).json()) as { scan: { scanId: string } };
  const confirmed = (await (
    await app.request(`/v1/scans/${scan.scan.scanId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tcgdexId: "base1-58" }),
    })
  ).json()) as { confirmation: { confirmationId: string } };
  const res = await app.request("/v1/inventory/purchased", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmationId: confirmed.confirmation.confirmationId, purchasePrice: "5", purchasedAt: new Date().toISOString() }),
  });
  expect(res.status).toBe(201);
}

describe("D10 GET /ops/north-star", () => {
  it("is 404 without an ops token and 401 with a wrong one", async () => {
    expect((await createApp(createMemoryStore(), { opsToken: "" }).request("/ops/north-star")).status).toBe(404);
    const app = createApp(createMemoryStore(), { opsToken: "t" });
    expect((await app.request("/ops/north-star", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("counts Purchased cards per weekly active reseller, counts only", async () => {
    const app = createApp(createMemoryStore(), { opsToken: "t" });
    await purchase(app);
    await purchase(app);
    const body = (await (
      await app.request("/ops/north-star?weeks=2", { headers: { authorization: "Bearer t" } })
    ).json()) as { metric: string; weeks: Array<{ purchased: number; activeResellers: number; perActiveReseller: number | null }> };
    expect(body.metric).toBe("Cards marked Purchased per weekly active reseller");
    expect(body.weeks).toHaveLength(2);
    expect(body.weeks[1]).toMatchObject({ purchased: 2, activeResellers: 1, perActiveReseller: 2 });
    expect(JSON.stringify(body)).not.toMatch(/userId|@cardflow\.beta/);
  });
});
