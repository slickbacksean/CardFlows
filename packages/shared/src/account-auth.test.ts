import { describe, expect, it } from "vitest";
import { ACCOUNT_AUTH_COPY, isValidEmail, passwordProblem } from "./account-auth";
import { GUEST_RETENTION_NOTE, GUEST_SCAN_WALL_NOTE, GUEST_SESSION_TTL_MS, GUEST_SIGNUP_COPY } from "./guest-access";

describe("open sign-up rules", () => {
  it("validates email and password", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
    expect(passwordProblem("short")).toBe(ACCOUNT_AUTH_COPY.badPassword);
    expect(passwordProblem("aaaaaaaaaaaa")).toBe(ACCOUNT_AUTH_COPY.badPassword);
    expect(passwordProblem("correct horse battery")).toBeNull();
  });
  it("sign-in failure copy doesn't say which part was wrong", () => {
    expect(ACCOUNT_AUTH_COPY.signInFailed).toBe("Email or password is incorrect.");
  });
  it("guest copy separates scans from estimates and states the 24-hour deletion", () => {
    expect(GUEST_SESSION_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(GUEST_SCAN_WALL_NOTE).toMatch(/counts scans only/);
    expect(GUEST_SIGNUP_COPY.scanLimit).toMatch(/not pre-grade estimates/);
    expect(GUEST_RETENTION_NOTE).toMatch(/within 24 hours/);
  });
});
