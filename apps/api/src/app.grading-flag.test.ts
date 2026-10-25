/** Grading feature flag tests (flag defaults to off in production, on in tests). */
import { describe, expect, it } from "vitest";
import { FEATURE_DISABLED_CODE, GRADING_DISABLED_COPY } from "@cardflow/shared";
import { createApp } from "./app";
import { createMemoryStore } from "./store";

describe("grading feature flag", () => {
  it("returns 503 feature_disabled on all grading routes when off", async () => {
    const app = createApp(createMemoryStore(), { gradingEnabled: () => false, devAutoSession: true });

    const routes = [
      "/v1/grading",
      "/v1/grading/submitted",
      "/v1/grading/returned",
      "/v1/grade/quota",
      "/v1/grade/credits",
      "/v1/grade/credits/consume",
      "/v1/grade/detect",
      "/v1/grade/pregrade",
      "/v1/grade/extra",
    ];

    for (const route of routes) {
      const method = route.includes("quota") && !route.includes("consume") ? "GET" : "POST";
      const response = await app.request(route, { method, body: method === "POST" ? new FormData() : undefined });
      expect(response.status, `${method} ${route}`).toBe(503);
      const body = (await response.json()) as { ok: boolean; code?: string; error?: string; feature?: string };
      expect(body.ok, `${method} ${route}`).toBe(false);
      expect(body.code, `${method} ${route}`).toBe(FEATURE_DISABLED_CODE);
      expect(body.feature, `${method} ${route}`).toBe("grading");
      expect(body.error, `${method} ${route}`).toBe(GRADING_DISABLED_COPY);
      expect(response.headers.get("x-cardflow-feature-disabled")).toBe("grading");
    }
  });

  it("returns 503 on inventory grade routes when off", async () => {
    const app = createApp(createMemoryStore(), { gradingEnabled: () => false, devAutoSession: true });

    const routes = [
      "/v1/inventory/item123/grade-estimate",
      "/v1/inventory/item123/grade-jobs",
      "/v1/inventory/item123/grade-history",
      "/v1/inventory/item123/grade-photos/front",
    ];

    for (const route of routes) {
      const method = route.includes("photos") || route.includes("history") || route === "/v1/inventory/item123/grade-jobs" ? "GET" : "POST";
      const response = await app.request(route, { method, body: method === "POST" ? new FormData() : undefined });
      expect(response.status, `${method} ${route}`).toBe(503);
      const body = (await response.json()) as { ok: boolean; code?: string; feature?: string };
      expect(body.code, `${method} ${route}`).toBe(FEATURE_DISABLED_CODE);
      expect(body.feature, `${method} ${route}`).toBe("grading");
    }
  });

  it("reports grading flag in /v1/status features", async () => {
    const on = createApp(createMemoryStore(), { gradingEnabled: () => true });
    const onStatus = await on.request("/v1/status");
    const onBody = (await onStatus.json()) as { features?: { grading?: boolean; livestream?: boolean } };
    expect(onBody.features?.grading).toBe(true);
    expect(onBody.features?.livestream).toBe(true);

    const off = createApp(createMemoryStore(), { gradingEnabled: () => false });
    const offStatus = await off.request("/v1/status");
    const offBody = (await offStatus.json()) as { features?: { grading?: boolean; livestream?: boolean } };
    expect(offBody.features?.grading).toBe(false);
    expect(offBody.features?.livestream).toBe(true);
  });

  it("defaults to off in production (CARD_FLOW_GRADING_ENABLED unset or explicit off values)", async () => {
    const { gradingEnabledFromEnv } = await import("@cardflow/shared");
    expect(gradingEnabledFromEnv(undefined)).toBe(false);
    expect(gradingEnabledFromEnv("")).toBe(false);
    expect(gradingEnabledFromEnv("0")).toBe(false);
    expect(gradingEnabledFromEnv("false")).toBe(false);
    expect(gradingEnabledFromEnv("off")).toBe(false);
    expect(gradingEnabledFromEnv("no")).toBe(false);
  });

  it("enables grading with explicit on values", async () => {
    const { gradingEnabledFromEnv } = await import("@cardflow/shared");
    expect(gradingEnabledFromEnv("1")).toBe(true);
    expect(gradingEnabledFromEnv("true")).toBe(true);
    expect(gradingEnabledFromEnv("on")).toBe(true);
    expect(gradingEnabledFromEnv("yes")).toBe(true);
    expect(gradingEnabledFromEnv("TRUE")).toBe(true);
    expect(gradingEnabledFromEnv("YES")).toBe(true);
  });
});
