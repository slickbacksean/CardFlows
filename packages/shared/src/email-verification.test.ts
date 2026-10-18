import { describe, expect, it } from "vitest";
import {
  EMAIL_UNVERIFIED_CODE,
  EMAIL_VERIFICATION_COPY,
  EMAIL_VERIFICATION_TTL_MS,
  isEmailCode,
  passwordResetEmailText,
  verificationEmailText,
} from "./email-verification";

describe("email verification rules", () => {
  it("codes are exactly 6 digits", () => {
    expect(isEmailCode("012345")).toBe(true);
    expect(isEmailCode(" 012345 ")).toBe(true);
    for (const bad of ["12345", "1234567", "12a456", ""]) expect(isEmailCode(bad)).toBe(false);
  });

  it("codes last 15 minutes and the copy says so", () => {
    expect(EMAIL_VERIFICATION_TTL_MS).toBe(15 * 60 * 1000);
    expect(EMAIL_VERIFICATION_COPY.sent).toContain("15 minutes");
    expect(verificationEmailText("123456")).toContain("123456");
    expect(passwordResetEmailText("tok")).toContain("1 hour");
    expect(EMAIL_UNVERIFIED_CODE).toBe("email_unverified");
  });

  it("no AI or grading-company wording in the copy", () => {
    const all = [...Object.values(EMAIL_VERIFICATION_COPY), verificationEmailText("1"), passwordResetEmailText("1")].join(" ");
    expect(all).not.toMatch(/\bAI\b|PSA|BGS|CGC|profit/);
    expect(EMAIL_VERIFICATION_COPY.required).toContain("pre-grade estimates");
  });
});
