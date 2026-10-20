import { describe, expect, it } from "vitest";
import { GUEST_SIGNUP_COPY, guestRouteAllowed, guestRouteBlockReason, isGuestUserId, signupMessage } from "./guest-access";
import * as shared from "./index";

/** Sean (Oct 17, 8:36 PM PT): guests browse; sign up before any scan, grade or save. */
describe("browse-only guests", () => {
  it("browse reads stay open", () => {
    for (const path of [
      "/v1/identity",
      "/v1/status",
      "/v1/catalog/search",
      "/v1/catalog/cards/base1-4",
      "/v1/pricing/cards/base1-4",
      "/v1/cards/base1-4/slab-estimates",
      "/v1/collection",
      "/v1/portfolio",
      "/v1/inventory",
      "/v1/grading",
      "/v1/preferences",
      "/v1/sales",
    ]) {
      expect(guestRouteAllowed("GET", path), path).toBe(true);
    }
  });

  it("refuses every scan, grade, livestream and CardSight route, any method", () => {
    const cases: Array<[string, string, string]> = [
      ["POST", "/v1/scans", "scan"],
      ["GET", "/v1/scans/s1", "scan"],
      ["GET", "/v1/scans/s1/image", "scan"],
      ["POST", "/v1/scans/s1/confirm", "scan"],
      ["POST", "/v1/scans/s1/reject", "scan"],
      ["POST", "/v1/livestream/identify", "scan"],
      ["GET", "/v1/livestream/guesses/base1-4", "scan"],
      ["GET", "/v1/grade/quota", "grade"],
      ["POST", "/v1/grade/credits/consume", "grade"],
      ["POST", "/v1/grade/credits", "grade"],
      ["GET", "/v1/grade-jobs/j1", "grade"],
      ["POST", "/v1/inventory/i1/grade-jobs", "grade"],
      ["GET", "/v1/inventory/i1/grade-photos/front", "grade"],
      ["GET", "/v1/inventory/i1/grade-history", "grade"],
      ["POST", "/v1/inventory/i1/grade-history", "grade"],
      ["POST", "/v1/grading/submitted", "grade"],
      ["POST", "/v1/grading/batch", "grade"],
      ["PATCH", "/v1/grading/returned/i1", "grade"],
      ["GET", "/v1/consents/cardsight", "cardsight"],
      ["POST", "/v1/consents/cardsight", "cardsight"],
      ["GET", "/v1/age-confirmation", "cardsight"],
      ["POST", "/v1/age-confirmation", "cardsight"],
    ];
    for (const [method, path, reason] of cases) expect(guestRouteBlockReason(method, path), `${method} ${path}`).toBe(reason);
  });

  it("refuses every save, purchase, watchlist or inventory write", () => {
    const writes: Array<[string, string]> = [
      ["POST", "/v1/inventory/purchased"],
      ["POST", "/v1/inventory/watchlist"],
      ["POST", "/v1/inventory/i1/purchased"],
      ["POST", "/v1/inventory/i1/purchase"],
      ["DELETE", "/v1/inventory/i1"],
      ["POST", "/v1/inventory/i1/drafts"],
      ["PATCH", "/v1/drafts/d1"],
      ["POST", "/v1/sales/i1"],
      ["PATCH", "/v1/preferences"],
      ["POST", "/v1/max-buy"],
      ["POST", "/v1/pricing/cards/base1-4/yours"],
      ["PATCH", "/v1/identity"],
    ];
    for (const [method, path] of writes) {
      expect(guestRouteAllowed(method, path), `${method} ${path}`).toBe(false);
    }
  });

  it("guests can still delete their session data and send perf telemetry", () => {
    expect(guestRouteAllowed("POST", "/v1/account/delete")).toBe(true);
    expect(guestRouteAllowed("POST", "/v1/telemetry/perf")).toBe(true);
  });

  it("recognizes guests", () => {
    expect(isGuestUserId("guest_abc")).toBe(true);
    expect(isGuestUserId("tester-1")).toBe(false);
  });

  it("one sign-up message for every wall; no guest scan allowance left anywhere", () => {
    expect(GUEST_SIGNUP_COPY.body).toBe("Create a free account to use PokeSniper.");
    for (const reason of ["scan", "grade", "cardsight", "save"] as const) expect(signupMessage(reason)).toBe(GUEST_SIGNUP_COPY.body);
    expect(Object.values(GUEST_SIGNUP_COPY).join(" ")).not.toMatch(/\bAI\b|PSA|BGS|CGC|profit|guarantee|free month|reward|3 free|scans left/i);
    for (const name of ["GUEST_FREE_SCANS", "guestScansRemaining", "GUEST_SCAN_WALL_NOTE", "GUEST_RETENTION_NOTE"]) {
      expect(name in shared, name).toBe(false);
    }
  });
});
