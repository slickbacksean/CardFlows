import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("P1-21 GET /v1/status", () => {
  it("shows pricing delayed while the pricing flag is off", async () => {
    const app = createApp(undefined, { statusCacheMs: 0 });
    const body = (await (await app.request("/v1/status")).json()) as { ok: boolean; banners: Array<{ id: string; message: string }> };
    expect(body.ok).toBe(true);
    expect(body.banners.map((b) => b.id)).toContain("pricing_delayed");
    expect(body.banners[0]?.message).toBe("Prices are delayed right now. You can enter your own.");
  });

  it("flags the grader when its probe fails and clears when it recovers", async () => {
    let ok = false;
    const app = createApp(undefined, {
      statusCacheMs: 0,
      gradeEngineProbe: async () => (ok ? { ok: true } : { ok: false, error: "cv2 missing" }) as never,
    });
    const ids = async () => ((await (await app.request("/v1/status")).json()) as { banners: Array<{ id: string }> }).banners.map((b) => b.id);
    expect(await ids()).toContain("pregrade_unavailable");
    ok = true;
    expect(await ids()).not.toContain("pregrade_unavailable");
  });
});

describe("P1-21 ops_notice copy rule on the server", () => {
  it("never serves an operator note naming a grader, AI, or promising profit", async () => {
    const prev = process.env.CARD_FLOW_STATUS_MESSAGE;
    try {
      process.env.CARD_FLOW_STATUS_MESSAGE = "AI says PSA 10 — guaranteed profit";
      const bad = (await (await createApp(undefined, { statusCacheMs: 0 }).request("/v1/status")).json()) as { banners: Array<{ id: string }> };
      expect(bad.banners.map((b) => b.id)).not.toContain("ops_notice");
      process.env.CARD_FLOW_STATUS_MESSAGE = "Maintenance at 9 PM PT";
      const ok = (await (await createApp(undefined, { statusCacheMs: 0 }).request("/v1/status")).json()) as { banners: Array<{ id: string; message: string }> };
      expect(ok.banners.find((b) => b.id === "ops_notice")?.message).toBe("Maintenance at 9 PM PT");
    } finally {
      if (prev === undefined) delete process.env.CARD_FLOW_STATUS_MESSAGE;
      else process.env.CARD_FLOW_STATUS_MESSAGE = prev;
    }
  });
});
