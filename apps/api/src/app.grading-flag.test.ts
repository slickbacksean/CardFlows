/** Grading feature flag tests (flag defaults to off in production, on in tests). */
import { describe, expect, it } from "vitest";
import { FEATURE_DISABLED_CODE, GRADING_DISABLED_COPY } from "@cardflow/shared";
import { createApp } from "./app";
import { createMemoryStore } from "./store";

describe("grading feature flag", () => {
  it("returns 503 feature_disabled on all grading routes when off", async () => {
    const app = createApp(createMemoryStore(), { gradingEnabled: () => false, devAutoSession: true });

    const routes: Array<[string, string, unknown?]> = [
      ["GET", "/v1/grading"],
      ["POST", "/v1/grading/submitted", { inventoryItemId: "item123", name: "Pikachu" }],
      ["PATCH", "/v1/grading/submitted/item123", { status: "sent" }],
      ["POST", "/v1/grading/returned", { inventoryItemId: "item123" }],
      ["PATCH", "/v1/grading/returned/item123", { certNumber: "12345" }],
    ];

    for (const [method, route, body] of routes) {
      const response = await app.request(route, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(response.status, `${method} ${route}`).toBe(503);
      const json = (await response.json()) as { ok: boolean; code?: string; error?: string; feature?: string };
      expect(json.ok, `${method} ${route}`).toBe(false);
      expect(json.code, `${method} ${route}`).toBe(FEATURE_DISABLED_CODE);
      expect(json.feature, `${method} ${route}`).toBe("grading");
      expect(json.error, `${method} ${route}`).toBe(GRADING_DISABLED_COPY);
      expect(response.headers.get("x-cardflow-feature-disabled")).toBe("grading");
    }
  });

  it("returns 503 on grade estimate routes when off", async () => {
    const app = createApp(createMemoryStore(), { gradingEnabled: () => false, devAutoSession: true });

    const form = new FormData();
    form.append("photo", new Blob(["fake-image"], { type: "image/jpeg" }), "test.jpg");

    const routes = [
      ["/v1/grade/detect", form],
      ["/v1/grade/pregrade", form],
      ["/v1/inventory/item123/grade-estimate", form],
    ];

    for (const [route, body] of routes) {
      const response = await app.request(route as string, { method: "POST", body: body as FormData });
      expect(response.status, `POST ${route}`).toBe(503);
      const json = (await response.json()) as { ok: boolean; code?: string; feature?: string };
      expect(json.code, `POST ${route}`).toBe(FEATURE_DISABLED_CODE);
      expect(json.feature, `POST ${route}`).toBe("grading");
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

