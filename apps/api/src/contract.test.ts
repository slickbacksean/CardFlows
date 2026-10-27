import { apiContractRoutes, defineRoute } from "@cardflow/shared";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "./app";
import { contractMiddleware, contractStrictFromEnv } from "./contract-middleware";

describe("API contract coverage", () => {
  it("every API route has a contract entry and every contract entry has a route", () => {
    const app = createApp(undefined, { devAutoSession: true });
    const registered = new Set(
      app.routes
        .filter((route) => route.method !== "ALL")
        .filter((route) => !route.path.startsWith("/admin")) // Admin routes use server-rendered HTML, not contract
        .map((route) => `${route.method} ${route.path}`),
    );
    const contract = new Set(apiContractRoutes.map((route) => `${route.method} ${route.path}`));
    expect([...registered].filter((key) => !contract.has(key)).sort()).toEqual([]);
    expect([...contract].filter((key) => !registered.has(key)).sort()).toEqual([]);
  });

  it("is strict under Vitest and configurable by env", () => {
    expect(contractStrictFromEnv({ VITEST: "true" })).toBe(true);
    expect(contractStrictFromEnv({})).toBe(false);
    expect(contractStrictFromEnv({ CARD_FLOW_CONTRACT_STRICT: "1" })).toBe(true);
    expect(contractStrictFromEnv({ VITEST: "true", CARD_FLOW_CONTRACT_STRICT: "0" })).toBe(false);
  });
});

const thing = defineRoute({
  method: "POST",
  path: "/v1/things/:id",
  bodyKind: "json",
  body: z.object({ name: z.string() }),
  response: z.looseObject({ ok: z.literal(true), count: z.number() }),
});

function toyApp(strict: boolean, payload: unknown, status: 200 | 400 = 200) {
  const app = new Hono();
  const onMismatch = vi.fn();
  app.use("*", contractMiddleware({ strict, routes: [thing], onMismatch }));
  app.post("/v1/things/:id", async (c) => {
    await c.req.json();
    return c.json(payload as object, status);
  });
  return { app, onMismatch };
}

function post(app: Hono, body: unknown) {
  return app.request("/v1/things/1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("contract middleware", () => {
  it("passes a matching response through untouched", async () => {
    const { app, onMismatch } = toyApp(true, { ok: true, count: 2, extra: "kept" });
    const res = await post(app, { name: "a" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: 2, extra: "kept" });
    expect(onMismatch).not.toHaveBeenCalled();
  });

  it("turns a drifted response into a 500 when strict (fails CI)", async () => {
    const { app } = toyApp(true, { ok: true, count: "2" });
    const res = await post(app, { name: "a" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { issues: string[] };
    expect(body.issues.join(" ")).toContain("count");
  });

  it("only logs a drifted response in production", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { app, onMismatch } = toyApp(false, { ok: true, count: "2" });
    const res = await post(app, { name: "a" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: "2" });
    expect(onMismatch).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("flags a request body the handler accepted but the contract rejects", async () => {
    const { app } = toyApp(true, { ok: true, count: 1 });
    const res = await post(app, { name: 7 });
    expect(res.status).toBe(500);
  });

  it("leaves a handler's own 4xx rejection alone", async () => {
    const { app, onMismatch } = toyApp(true, { ok: false, error: "name is required" }, 400);
    const res = await post(app, { name: 7 });
    expect(res.status).toBe(400);
    expect(onMismatch).not.toHaveBeenCalled();
  });
});
