import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createMemoryStore } from "./store";

const TINY_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

async function postScan(app: ReturnType<typeof createApp>, key?: string) {
  const form = new FormData();
  form.append("captureMethod", "camera_photo");
  form.append("image", new File([TINY_JPEG], "still.jpg", { type: "image/jpeg" }));
  const res = await app.request("/v1/scans", { method: "POST", body: form, headers: key ? { "idempotency-key": key } : {} });
  return { status: res.status, body: (await res.json()) as { scan: { scanId: string } } };
}

describe("P1-10 replayed offline scans", () => {
  it("the same Idempotency-Key returns the first scan instead of a second one", async () => {
    const app = createApp(createMemoryStore());
    const first = await postScan(app, "offline-key-1");
    const replay = await postScan(app, "offline-key-1");
    expect(first.status).toBe(201);
    expect(replay.body.scan.scanId).toBe(first.body.scan.scanId);
    expect(first.body.scan.scanId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    const other = await postScan(app, "offline-key-2");
    const noKey = await postScan(app);
    expect(new Set([first.body.scan.scanId, other.body.scan.scanId, noKey.body.scan.scanId]).size).toBe(3);
  });
});
