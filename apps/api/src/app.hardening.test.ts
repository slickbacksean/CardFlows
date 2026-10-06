import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { JSON_BODY_MAX_BYTES, LIVESTREAM_IDENTIFY_BODY_MAX_BYTES } from "./request-limits";
import { createMemoryStore } from "./store";

type App = ReturnType<typeof createApp>;

async function postJson(app: App, pathName: string, body: string) {
  return app.request(pathName, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("API hardening", () => {
  it("rejects a non-image upload before it is stored", async () => {
    const app = createApp(createMemoryStore());
    const form = new FormData();
    form.append("captureMethod", "camera_photo");
    form.append("image", new File([Uint8Array.from([1, 2, 3, 4])], "still.jpg", { type: "image/jpeg" }));
    const response = await app.request("/v1/scans", { method: "POST", body: form });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Image must be jpeg, png, or webp" });

    const scans = await app.request("/v1/scans/missing/image");
    expect(scans.status).toBe(404);
  });

  it("rejects an oversized identify body and an oversized JSON body", async () => {
    const app = createApp(createMemoryStore());
    const identify = await postJson(
      app,
      "/v1/livestream/identify",
      JSON.stringify({
        source: "live_video",
        identityCropJpeg: "a".repeat(LIVESTREAM_IDENTIFY_BODY_MAX_BYTES),
      }),
    );
    expect(identify.status).toBe(413);
    expect(await identify.json()).toMatchObject({ error: "Request is too large" });

    const prefs = await postJson(
      app,
      "/v1/max-buy",
      JSON.stringify({ referencePriceAmount: "1".repeat(JSON_BODY_MAX_BYTES) }),
    );
    expect(prefs.status).toBe(413);
  });

  it("marks a rejected scan identity_rejected and does not write inventory", async () => {
    const store = createMemoryStore();
    const app = createApp(store);
    const created = await postJson(
      app,
      "/v1/scans",
      JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    );
    expect(created.status).toBe(201);
    const scanId = ((await created.json()) as { scan: { scanId: string } }).scan.scanId;

    const rejected = await app.request(`/v1/scans/${scanId}/reject`, { method: "POST" });
    expect(rejected.status).toBe(200);
    const body = (await rejected.json()) as { scan: { preInventoryState: string; cardflowCardId: string | null } };
    expect(body.scan.preInventoryState).toBe("identity_rejected");
    expect(body.scan.cardflowCardId).toBeNull();

    const again = await app.request(`/v1/scans/${scanId}/reject`, { method: "POST" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { scan: { preInventoryState: string } }).scan.preInventoryState).toBe(
      "identity_rejected",
    );

    const inventory = await app.request("/v1/inventory");
    expect(((await inventory.json()) as { items: unknown[] }).items).toEqual([]);
  });

  it("does not echo a browser origin that is not on the allow list", async () => {
    const closed = createApp(createMemoryStore());
    const denied = await closed.request("/health", { headers: { origin: "https://evil.example" } });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    const open = createApp(createMemoryStore(), {
      corsOrigins: ["https://cardflow.example"],
    });
    const allowed = await open.request("/health", {
      headers: { origin: "https://cardflow.example" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://cardflow.example");
    const native = await open.request("/health");
    expect(native.status).toBe(200);
    expect(native.headers.get("access-control-allow-origin")).toBeNull();
  });
});
