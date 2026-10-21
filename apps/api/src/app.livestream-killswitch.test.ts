import { describe, expect, it } from "vitest";
import { FEATURE_DISABLED_CODE, LIVESTREAM_DISABLED_COPY } from "@cardflow/shared";
import { createApp } from "./app";

describe("Live Scan kill switch", () => {
  it("returns 503 feature_disabled on every livestream route while off", async () => {
    const app = createApp(undefined, { livestreamEnabled: () => false, statusCacheMs: 0 });
    for (const [method, path] of [
      ["GET", "/v1/livestream/access"],
      ["GET", "/v1/livestream/guesses/base1-4"],
      ["POST", "/v1/livestream/identify"],
    ] as const) {
      const res = await app.request(path, { method, headers: { "content-type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) });
      expect(res.status, path).toBe(503);
      expect(res.headers.get("x-cardflow-feature-disabled")).toBe("livestream");
      expect(await res.json()).toMatchObject({ ok: false, code: FEATURE_DISABLED_CODE, feature: "livestream", error: LIVESTREAM_DISABLED_COPY });
    }
  });

  it("reports the flag on /v1/status and flips without a restart", async () => {
    let on = true;
    const app = createApp(undefined, { livestreamEnabled: () => on, statusCacheMs: 60_000 });
    const read = async () => ((await (await app.request("/v1/status")).json()) as { features?: { livestream: boolean } }).features;
    expect(await read()).toEqual({ livestream: true });
    on = false;
    expect(await read()).toEqual({ livestream: false });
    expect((await app.request("/v1/livestream/access")).status).toBe(503);
  });

  it("defaults on from CARD_FLOW_LIVESTREAM_ENABLED", async () => {
    const prev = process.env.CARD_FLOW_LIVESTREAM_ENABLED;
    try {
      delete process.env.CARD_FLOW_LIVESTREAM_ENABLED;
      const app = createApp(undefined, { statusCacheMs: 0 });
      expect((await app.request("/v1/livestream/access")).status).not.toBe(503);
      process.env.CARD_FLOW_LIVESTREAM_ENABLED = "false";
      expect((await app.request("/v1/livestream/access")).status).toBe(503);
    } finally {
      if (prev === undefined) delete process.env.CARD_FLOW_LIVESTREAM_ENABLED;
      else process.env.CARD_FLOW_LIVESTREAM_ENABLED = prev;
    }
  });
});
