import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createMemoryStore } from "./store";

type App = ReturnType<typeof createApp>;
const TINY_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

async function purchased(app: App) {
  const form = new FormData();
  form.append("captureMethod", "camera_photo");
  form.append("scenario", "high-confidence");
  form.append("image", new File([TINY_JPEG], "still.jpg", { type: "image/jpeg" }));
  const scan = (await (await app.request("/v1/scans", { method: "POST", body: form })).json()) as { scan: { scanId: string } };
  const confirmed = (await (
    await app.request(`/v1/scans/${scan.scan.scanId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tcgdexId: "base1-58" }),
    })
  ).json()) as { confirmation: { confirmationId: string } };
  const item = (await (
    await app.request("/v1/inventory/purchased", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmationId: confirmed.confirmation.confirmationId, purchasePrice: "10", purchasedAt: "2026-10-01" }),
    })
  ).json()) as { item: { inventoryItemId: string } };
  return item.item.inventoryItemId;
}

const send = (app: App, method: string, path: string, key: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe("queued write idempotency (all kinds)", () => {
  it("a replayed sale save returns the first response; a different body is 422", async () => {
    const app = createApp(createMemoryStore());
    const id = await purchased(app);
    const first = await send(app, "POST", `/v1/sales/${id}`, "sale-1", { price: "25", soldAt: "2026-10-05" });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    const replay = await send(app, "POST", `/v1/sales/${id}`, "sale-1", { price: "25", soldAt: "2026-10-05" });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);
    expect((await send(app, "POST", `/v1/sales/${id}`, "sale-1", { price: "30", soldAt: "2026-10-05" })).status).toBe(422);
  });

  it("a replayed delete answers like the first delete", async () => {
    const app = createApp(createMemoryStore());
    const id = await purchased(app);
    await send(app, "POST", `/v1/sales/${id}`, "s", { price: "25", soldAt: "2026-10-05" });
    const first = (await (await send(app, "DELETE", `/v1/sales/${id}`, "d")).json()) as { deleted: boolean };
    const again = (await (await send(app, "DELETE", `/v1/sales/${id}`, "d")).json()) as { deleted: boolean };
    expect(first.deleted).toBe(true);
    expect(again.deleted).toBe(true);
  });

  it("a key reused for a different request is 422", async () => {
    const app = createApp(createMemoryStore());
    const id = await purchased(app);
    expect((await send(app, "POST", `/v1/sales/${id}`, "k", { price: "1", soldAt: "2026-10-05" })).status).toBe(200);
    expect((await send(app, "DELETE", `/v1/sales/${id}`, "k")).status).toBe(422);
  });
});
