import { describe, expect, it } from "vitest";
import {
  DEFAULT_INVITED_USER_ID,
  GRADE_QUOTA_COPY,
  GRADE_QUOTA_FREE_PER_MONTH,
  GRADE_QUOTA_PREMIUM_PER_MONTH,
  type GradeQuotaSnapshot,
} from "@cardflow/shared";
import { createApp } from "./app";
import { consumeCardSightBudget } from "./cardsight-budget";
import { appApiKeyFromEnv } from "./app-api-key";
import {
  cardSightMonthlyBudgetFromEnv,
  gradeIapFromEnv,
  gradeQuotaEnabledFromEnv,
} from "./grade-quota-env";
import { createMemoryStore } from "./store";
import { createSqliteStore } from "./sqlite-store";

type QuotaBody = { ok?: boolean; error?: string; quota?: GradeQuotaSnapshot };

async function json<T>(app: ReturnType<typeof createApp>, pathName: string, init: RequestInit = {}) {
  const response = await app.request(pathName, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  return { status: response.status, body: (await response.json()) as T, response };
}

const TINY_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

function pregradeForm() {
  const form = new FormData();
  form.append("front", new File([TINY_JPEG], "front.jpg", { type: "image/jpeg" }));
  form.append("back", new File([TINY_JPEG], "back.jpg", { type: "image/jpeg" }));
  return form;
}

describe("monthly grade quotas", () => {
  it("reads env defaults: off in tests, IAP off, CardSight budget 750 outside tests", () => {
    expect(gradeQuotaEnabledFromEnv({ VITEST: "true" })).toBe(false);
    expect(gradeQuotaEnabledFromEnv({ VITEST: "true", CARD_FLOW_GRADE_QUOTA: "true" })).toBe(true);
    expect(gradeQuotaEnabledFromEnv({})).toBe(true);
    expect(gradeIapFromEnv({})).toEqual({ enabled: false, stub: false });
    expect(cardSightMonthlyBudgetFromEnv({ VITEST: "true" })).toBeNull();
    expect(cardSightMonthlyBudgetFromEnv({})).toBe(750);
    expect(appApiKeyFromEnv({ VITEST: "true" })).toBeNull();
    expect(appApiKeyFromEnv({ CARD_FLOW_APP_API_KEY: "bump" })).toBe("bump");
  });

  it("shows remaining grades and spends the free monthly allowance first", async () => {
    const app = createApp(createMemoryStore(), { devAutoSession: true, gradeQuota: true });
    const listed = await json<QuotaBody>(app, "/v1/grade/quota");
    expect(listed.status).toBe(200);
    expect(listed.body.quota).toMatchObject({
      plan: "free",
      monthlyLimit: GRADE_QUOTA_FREE_PER_MONTH,
      remainingGrades: GRADE_QUOTA_FREE_PER_MONTH,
      extraCredits: 0,
      iapEnabled: false,
    });

    for (let i = 0; i < GRADE_QUOTA_FREE_PER_MONTH; i += 1) {
      const used = await json<QuotaBody>(app, "/v1/grade/credits/consume", { method: "POST", body: "{}" });
      expect(used.status).toBe(200);
    }
    const blocked = await json<QuotaBody>(app, "/v1/grade/credits/consume", { method: "POST", body: "{}" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe(GRADE_QUOTA_COPY.outOfGrades);
    expect(blocked.body.error).not.toMatch(/\bAI\b|\bPSA\b|\bBGS\b|\bCGC\b/);
    expect(blocked.body.quota?.remainingGrades).toBe(0);
    expect(blocked.response.headers.get("retry-after")).toBeTruthy();
  });

  it("lets extra credits cover grades after the monthly allowance", async () => {
    const store = createMemoryStore();
    store.addGradeCredits(DEFAULT_INVITED_USER_ID, 2, "2026-10-13T00:00:00.000Z");
    const app = createApp(store, { devAutoSession: true, gradeQuota: true });
    for (let i = 0; i < GRADE_QUOTA_FREE_PER_MONTH + 2; i += 1) {
      expect(
        (await json<QuotaBody>(app, "/v1/grade/credits/consume", { method: "POST", body: "{}" })).status,
      ).toBe(200);
    }
    const blocked = await json<QuotaBody>(app, "/v1/grade/credits/consume", { method: "POST", body: "{}" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.quota?.extraCredits).toBe(0);
  });

  it("gives premium accounts 30 grades in the UTC month", async () => {
    const store = createMemoryStore();
    store.setGradePlan(DEFAULT_INVITED_USER_ID, "premium", "2026-10-13T00:00:00.000Z");
    const app = createApp(store, { devAutoSession: true, gradeQuota: true });
    const listed = await json<QuotaBody>(app, "/v1/grade/quota");
    expect(listed.body.quota?.monthlyLimit).toBe(GRADE_QUOTA_PREMIUM_PER_MONTH);
    expect(listed.body.quota?.remainingGrades).toBe(GRADE_QUOTA_PREMIUM_PER_MONTH);
  });

  it("resets used counts when the UTC month rolls over", async () => {
    let nowMs = Date.parse("2026-10-31T12:00:00.000Z");
    const store = createMemoryStore();
    const app = createApp(store, {
      devAutoSession: true,
      gradeQuota: true,
      now: () => new Date(nowMs),
    });
    for (let i = 0; i < GRADE_QUOTA_FREE_PER_MONTH; i += 1) {
      expect(
        (await json<QuotaBody>(app, "/v1/grade/credits/consume", { method: "POST", body: "{}" })).status,
      ).toBe(200);
    }
    expect(
      (await json<QuotaBody>(app, "/v1/grade/credits/consume", { method: "POST", body: "{}" })).status,
    ).toBe(429);
    nowMs = Date.parse("2026-11-01T00:00:00.000Z");
    const next = await json<QuotaBody>(app, "/v1/grade/quota");
    expect(next.body.quota).toMatchObject({ month: "2026-11", usedThisMonth: 0, remainingGrades: 5 });
    expect(
      (await json<QuotaBody>(app, "/v1/grade/credits/consume", { method: "POST", body: "{}" })).status,
    ).toBe(200);
  });

  it("enforces the quota on pregrade after photos parse, and leaves detect free", async () => {
    const store = createMemoryStore();
    const app = createApp(store, { devAutoSession: true, gradeQuota: true });
    for (let i = 0; i < GRADE_QUOTA_FREE_PER_MONTH; i += 1) {
      await json<QuotaBody>(app, "/v1/grade/credits/consume", { method: "POST", body: "{}" });
    }
    const detect = await app.request("/v1/grade/detect", { method: "POST", body: new FormData() });
    expect(detect.status).not.toBe(429);
    const grade = await app.request("/v1/grade/pregrade", { method: "POST", body: pregradeForm() });
    expect(grade.status).toBe(429);
    expect(((await grade.json()) as QuotaBody).error).toBe(GRADE_QUOTA_COPY.outOfGrades);
  });

  it("keeps per-IP rate limiting next to the monthly quota", async () => {
    const app = createApp(createMemoryStore(), {
      devAutoSession: true,
      gradeQuota: true,
      gradeRateLimit: { perMinute: 1, perDay: 100 },
    });
    const first = await app.request("/v1/grade/pregrade", { method: "POST", body: new FormData() });
    expect(first.status).not.toBe(429);
    const limited = await app.request("/v1/grade/pregrade", { method: "POST", body: new FormData() });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as QuotaBody).error).toBe("Too many requests. Try again in a moment.");
  });

  it("leaves purchases unimplemented unless the IAP stub is on", async () => {
    const closed = createApp(createMemoryStore(), { devAutoSession: true, gradeQuota: true });
    const denied = await json<QuotaBody>(closed, "/v1/grade/credits", {
      method: "POST",
      body: JSON.stringify({ credits: 3 }),
    });
    expect(denied.status).toBe(503);
    expect(denied.body.error).toBe(GRADE_QUOTA_COPY.iapUnavailable);

    const stub = createApp(createMemoryStore(), {
      devAutoSession: true,
      gradeQuota: true,
      gradeIap: { enabled: false, stub: true },
    });
    const granted = await json<QuotaBody>(stub, "/v1/grade/credits", {
      method: "POST",
      body: JSON.stringify({ credits: 3, plan: "premium" }),
    });
    expect(granted.status).toBe(200);
    expect(granted.body.quota).toMatchObject({ extraCredits: 3, plan: "premium", monthlyLimit: 30 });
  });

  it("requires the app API key when configured", async () => {
    const app = createApp(createMemoryStore(), {
      devAutoSession: true,
      appApiKey: "speed-bump",
    });
    const missing = await json<QuotaBody>(app, "/v1/grade/quota");
    expect(missing.status).toBe(401);
    const ok = await json<QuotaBody>(app, "/v1/grade/quota", {
      headers: { "x-cardflow-app-key": "speed-bump" },
    });
    expect(ok.status).toBe(200);
  });

  it("persists plan, credits, and usage in SQLite", () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    try {
      store.setGradePlan(DEFAULT_INVITED_USER_ID, "premium", "2026-10-13T00:00:00.000Z");
      store.addGradeCredits(DEFAULT_INVITED_USER_ID, 4, "2026-10-13T00:00:00.000Z");
      const first = store.consumeGradeQuota(DEFAULT_INVITED_USER_ID, {
        monthKey: "2026-10",
        monthlyLimit: 30,
        at: "2026-10-13T00:00:00.000Z",
      });
      expect(first).toMatchObject({ ok: true, source: "monthly", usedThisMonth: 1, extraCredits: 4 });
      expect(store.getGradeAccount(DEFAULT_INVITED_USER_ID)).toEqual({
        plan: "premium",
        extraCredits: 4,
      });
      expect(store.getGradeQuotaUsage(DEFAULT_INVITED_USER_ID, "2026-10")).toBe(1);
    } finally {
      store.close();
    }
  });

  it("refuses CardSight calls after the monthly budget", () => {
    const store = createMemoryStore();
    const now = new Date("2026-10-13T00:00:00.000Z");
    expect(consumeCardSightBudget({ consume: store.consumeVendorQuota, cap: 2, now })).toBe(true);
    expect(consumeCardSightBudget({ consume: store.consumeVendorQuota, cap: 2, now })).toBe(true);
    expect(consumeCardSightBudget({ consume: store.consumeVendorQuota, cap: 2, now })).toBe(false);
    expect(store.getVendorQuotaUsage("cardsight", "2026-10")).toBe(2);
  });
});
