import { describe, expect, it } from "vitest";
import { GUEST_SIGNUP_COPY, guestRouteAllowed, guestScansRemaining, isGuestUserId } from "./guest-access";

describe("D9 guest access", () => {
  it("only lets guests read and create scans", () => {
    expect(guestRouteAllowed("GET", "/v1/inventory")).toBe(true);
    expect(guestRouteAllowed("POST", "/v1/scans")).toBe(true);
    expect(guestRouteAllowed("POST", "/v1/scans/s1/confirm")).toBe(false);
    expect(guestRouteAllowed("POST", "/v1/inventory/purchased")).toBe(false);
    expect(guestRouteAllowed("PATCH", "/v1/drafts/d1")).toBe(false);
  });
  it("counts and recognizes guests", () => {
    expect(guestScansRemaining(0)).toBe(3);
    expect(guestScansRemaining(5)).toBe(0);
    expect(isGuestUserId("guest_abc")).toBe(true);
    expect(isGuestUserId("tester-1")).toBe(false);
  });
  it("copy makes no promises", () => {
    expect(Object.values(GUEST_SIGNUP_COPY).join(" ")).not.toMatch(/\bAI\b|PSA|BGS|CGC|profit|guarantee|free month|reward/i);
  });
});
