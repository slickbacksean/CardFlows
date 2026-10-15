import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  apiContract,
  apiContractRoutes,
  buildPath,
  buildQuery,
  checkRequestBody,
  checkResponse,
  matchRoute,
} from "./index";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

describe("API contract", () => {
  it("has one definition per method + path", () => {
    const keys = apiContractRoutes.map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const route of apiContractRoutes) expect(route.path.startsWith("/")).toBe(true);
  });

  it("builds encoded paths and skips blank query values", () => {
    expect(buildPath(apiContract.getScan.path, { scanId: "a b" })).toBe("/v1/scans/a%20b");
    expect(() => buildPath(apiContract.getScan.path, {})).toThrow(/scanId/);
    expect(buildQuery({ set: "base1", number: undefined, name: "" })).toBe("?set=base1");
    expect(buildQuery({})).toBe("");
  });

  it("prefers literal segments when matching", () => {
    expect(matchRoute(apiContractRoutes, "POST", "/v1/inventory/purchased")?.path).toBe(
      "/v1/inventory/purchased",
    );
    expect(matchRoute(apiContractRoutes, "POST", "/v1/inventory/item-1/purchased")?.path).toBe(
      "/v1/inventory/:inventoryItemId/purchased",
    );
    expect(matchRoute(apiContractRoutes, "GET", "/v1/nope")).toBeUndefined();
  });

  it("fails a response whose shape drifted and passes extra fields", () => {
    const good = {
      ok: true,
      quota: {
        plan: "free",
        month: "2026-10",
        monthlyLimit: 5,
        usedThisMonth: 1,
        remainingMonthly: 4,
        extraCredits: 0,
        remainingGrades: 4,
        resetsAt: "2026-11-01T00:00:00.000Z",
        iapEnabled: false,
        somethingNew: true,
      },
    };
    expect(checkResponse(apiContract.getGradeQuota, 200, good)).toEqual({ ok: true });
    const renamed = { ok: true, quota: { ...good.quota, remainingGrades: undefined, left: 4 } };
    const checked = checkResponse(apiContract.getGradeQuota, 200, renamed);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.issues).toContain("quota.remainingGrades");
  });

  it("checks error envelopes and request bodies", () => {
    expect(checkResponse(apiContract.getScan, 404, { ok: false, error: "Scan not found" }).ok).toBe(true);
    expect(checkResponse(apiContract.getScan, 404, { message: "nope" }).ok).toBe(false);
    expect(checkRequestBody(apiContract.createSession, { inviteCode: "x" }).ok).toBe(true);
    expect(checkRequestBody(apiContract.createSession, { inviteCode: 4 }).ok).toBe(false);
  });

  it("every phone API call goes through the typed client", () => {
    const client = readFileSync(path.join(REPO, "apps/mobile/lib/api.ts"), "utf8");
    // The transport `request()` is called from exactly one place: callApi.
    expect(client.match(/\brequest</g)?.length).toBe(2); // definition + the call in callApi
    expect(client).not.toMatch(/["'`]\/v1\//);
    expect(client).not.toMatch(/["'`]\/health["'`]/);
    const used = [...client.matchAll(/apiContract\.(\w+)/g)].map((m) => m[1]);
    for (const name of used) expect(Object.keys(apiContract)).toContain(name);
  });
});
