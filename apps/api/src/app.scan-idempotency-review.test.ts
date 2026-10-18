import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createIdempotencyRegistry, IDEMPOTENCY_TTL_MS } from "./idempotency";
import { createMemoryStore } from "./store";

type App = ReturnType<typeof createApp>;
async function scan(app: App, key: string | null, scenario = "high-confidence", token?: string, captureMethod = "camera_photo") {
  const res = await app.request("/v1/scans", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { "idempotency-key": key } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ captureMethod, scenario }),
  });
  return { status: res.status, body: (await res.json()) as { scan?: { scanId: string }; error?: string } };
}

describe("scan idempotency", () => {
  it("replays the same body, rejects a different body with 422", async () => {
    const app = createApp(createMemoryStore());
    const first = await scan(app, "k1");
    const again = await scan(app, "k1");
    expect(again.status).toBe(201);
    expect(again.body.scan?.scanId).toBe(first.body.scan?.scanId);
    const changed = await scan(app, "k1", "high-confidence", undefined, "manual_scan");
    expect(changed.status).toBe(422);
  });

  it("concurrent requests with one key make one scan", async () => {
    const app = createApp(createMemoryStore());
    const results = await Promise.all([scan(app, "same"), scan(app, "same"), scan(app, "same")]);
    const ids = new Set(results.map((r) => r.body.scan?.scanId));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(ids.size).toBe(1);
  });

  it("browse-only guests (Sean, Oct 17): even a keyed scan is signup_required", async () => {
    const app = createApp(createMemoryStore(), { devAutoSession: false, guestMode: true });
    const token = ((await (await app.request("/v1/sessions/guest", { method: "POST" })).json()) as { token: string }).token;
    expect((await scan(app, "g1", "high-confidence", token)).status).toBe(403);
    expect((await scan(app, "g1", "high-confidence", token)).status).toBe(403);
  });

  it("after a restart (empty registry) the persisted first scan is replayed", async () => {
    const store = createMemoryStore();
    const first = await scan(createApp(store), "restart-key");
    const replay = await scan(createApp(store), "restart-key");
    expect(replay.status).toBe(201);
    expect(replay.body.scan?.scanId).toBe(first.body.scan?.scanId);
  });

  it("keys expire after 24 hours", () => {
    let t = 0;
    const reg = createIdempotencyRegistry<string>(() => t);
    const c = reg.claim("k");
    expect(c.kind).toBe("new");
    if (c.kind === "new") c.finish("h", "scan-1");
    expect(reg.claim("k").kind).toBe("replay");
    t = IDEMPOTENCY_TTL_MS + 1;
    expect(reg.claim("k").kind).toBe("new");
  });
});
