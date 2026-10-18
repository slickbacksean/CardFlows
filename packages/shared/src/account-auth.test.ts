import { describe, expect, it } from "vitest";
import { ACCOUNT_AUTH_COPY, isValidEmail, passwordProblem } from "./account-auth";
import { GUEST_SESSION_TTL_MS, GUEST_SIGNUP_COPY } from "./guest-access";

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
  it("browse-only guests (Sean, Oct 17): 24-hour sessions and one sign-up message", () => {
    expect(GUEST_SESSION_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(GUEST_SIGNUP_COPY.body).toBe("Sign up to scan, grade and save cards. It's free.");
  });
});

describe("sign-up free plan note", () => {
  it("is the approved allowance copy", async () => {
    const { SIGNUP_FREE_PLAN_NOTE } = await import("./account-auth");
    const { SIGNUP_ALLOWANCE_NOTE } = await import("./premium");
    expect(SIGNUP_FREE_PLAN_NOTE).toBe(SIGNUP_ALLOWANCE_NOTE);
    expect(SIGNUP_FREE_PLAN_NOTE).not.toMatch(/\bAI\b|PSA|BGS|CGC|profit|guarantee/i);
  });
});
