import { describe, expect, it } from "vitest";
import { identityForInviteCode, invitedTesters } from "./invited-testers";

describe("invite codes fail closed", () => {
  it("has no built-in codes outside tests", () => {
    const prod = { NODE_ENV: "production" };
    expect(invitedTesters(prod)).toEqual([]);
    expect(identityForInviteCode("alex-beta", prod)).toBeNull();
    expect(identityForInviteCode("test-invite-alex", prod)).toBeNull();
  });

  it("uses only the codes configured in env", () => {
    const env = { CARD_FLOW_INVITE_ALEX: "configured-alex" };
    expect(invitedTesters(env)).toHaveLength(1);
    expect(identityForInviteCode("configured-alex", env)).not.toBeNull();
    expect(identityForInviteCode("jordan-beta", env)).toBeNull();
  });

  it("keeps test-only fallbacks under vitest", () => {
    expect(invitedTesters({ VITEST: "true" })).toHaveLength(2);
  });
});
