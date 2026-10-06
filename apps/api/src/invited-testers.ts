import {
  INVITED_USERS,
  invitedIdentityByInviteCode,
  type InvitedIdentity,
  type InvitedTester,
} from "@cardflow/shared";

type Env = NodeJS.Dict<string | undefined>;

/** Test-only codes. Used only when VITEST / NODE_ENV=test and the env var is unset. */
export const ALEX_INVITE_CODE = "test-invite-alex";
export const JORDAN_INVITE_CODE = "test-invite-jordan";

function isTestEnv(env: Env): boolean {
  return env.VITEST === "true" || env.NODE_ENV === "test";
}

function code(env: Env, key: string, testFallback: string): string | null {
  const value = env[key]?.trim();
  if (value) return value;
  // Fail closed: outside tests there is no built-in invite code.
  return isTestEnv(env) ? testFallback : null;
}

/**
 * Server-only invite roster, loaded from env. Testers whose code is unset are
 * left out, so with no codes configured no invite login works.
 */
export function invitedTesters(env: Env = process.env): InvitedTester[] {
  const [alex, jordan] = INVITED_USERS;
  const roster: Array<{ userId: string; label: string; inviteCode: string | null }> = [
    { userId: alex.userId, label: alex.label, inviteCode: code(env, "CARD_FLOW_INVITE_ALEX", ALEX_INVITE_CODE) },
    {
      userId: jordan.userId,
      label: jordan.label,
      inviteCode: code(env, "CARD_FLOW_INVITE_JORDAN", JORDAN_INVITE_CODE),
    },
  ];
  return roster.filter((tester): tester is InvitedTester => tester.inviteCode !== null);
}

export function identityForInviteCode(inviteCode: string, env: Env = process.env): InvitedIdentity | null {
  return invitedIdentityByInviteCode(inviteCode, invitedTesters(env));
}
