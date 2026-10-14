import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { OpsMetrics, percentile, type OpsAlert, ERROR_SPIKE_MIN_REQUESTS } from "./ops-metrics";

describe("P1-17 ops metrics", () => {
  it("computes p50/p95 per route pattern", () => {
    const m = new OpsMetrics();
    for (let i = 1; i <= 100; i += 1) m.recordRequest("GET /v1/cards/:id", 200, i);
    const r = m.snapshot().routes[0]!;
    expect(r).toMatchObject({ route: "GET /v1/cards/:id", count: 100, p50Ms: 50, p95Ms: 95, errorRate: 0 });
    expect(percentile([], 50)).toBeNull();
  });

  it("alerts on a simulated vendor 401 immediately, once per cooldown", () => {
    const seen: OpsAlert[] = [];
    let t = 0;
    const m = new OpsMetrics([(a) => seen.push(a)], () => t);
    m.recordVendorResponse("pokecollector", 401);
    m.recordVendorResponse("pokecollector", 401);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe("vendor_401");
    t += 31 * 60_000;
    m.recordVendorResponse("pokecollector", 401);
    expect(seen).toHaveLength(2);
  });

  it("alerts on a 5xx spike", () => {
    const seen: OpsAlert[] = [];
    const m = new OpsMetrics([(a) => seen.push(a)]);
    for (let i = 0; i < ERROR_SPIKE_MIN_REQUESTS - 2; i += 1) m.recordRequest("GET /x", 200, 5);
    m.recordRequest("GET /x", 500, 5);
    m.recordRequest("GET /x", 500, 5);
    expect(seen.map((a) => a.kind)).toEqual(["server_5xx_spike"]);
  });

  it("records requests by route pattern and serves /ops/metrics only with the token", async () => {
    const metrics = new OpsMetrics();
    const app = createApp(undefined, { opsMetrics: metrics, opsToken: "s3cret" });
    await app.request("/v1/cards/does-not-exist");
    const routes = metrics.snapshot().routes.map((r) => r.route);
    expect(routes).toContain("GET /v1/cards/:cardflowCardId");
    expect(routes.join(" ")).not.toContain("does-not-exist");
    expect((await app.request("/ops/metrics")).status).toBe(401);
    const ok = await app.request("/ops/metrics", { headers: { authorization: "Bearer s3cret" } });
    expect(ok.status).toBe(200);
    const off = createApp(undefined, { opsMetrics: new OpsMetrics(), opsToken: null });
    expect((await off.request("/ops/metrics")).status).toBe(404);
  });
});

describe("P1-18 device perf telemetry", () => {
  it("accepts timings only and reports p95 per stage and device class", async () => {
    const metrics = new OpsMetrics();
    const app = createApp(undefined, { opsMetrics: metrics, opsToken: "t" });
    const samples = Array.from({ length: 20 }, (_, i) => ({ stage: "grade_still_prep", ms: (i + 1) * 10 }));
    const res = await app.request("/v1/telemetry/perf", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceClass: "mid",
        deviceModel: "iPhone 12",
        os: "ios",
        thermal: "serious",
        samples: [...samples, { stage: "image", ms: 1, jpeg: "AAAA" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 20 });
    const row = metrics.snapshot().devices[0]!;
    expect(row).toMatchObject({ stage: "grade_still_prep", deviceClass: "mid", count: 20, p95Ms: 190, hotShare: 1 });
    expect(JSON.stringify(metrics.snapshot())).not.toContain("AAAA");
  });
});
