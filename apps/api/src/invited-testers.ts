import {
  INVITED_USERS,
  invitedIdentityByInviteCode,
  type InvitedIdentity,
  type InvitedTester,
} from "@cardflow/shared";

type Env = NodeJS.Dict<string | undefined>;

/**
 * Server-only invite roster. Codes come only from env; an unset code means that tester
 * cannot sign in with a code (fail closed). No defaults ship in the code.
 */
export function invitedTesters(env: Env = process.env): InvitedTester[] {
  const [alex, jordan] = INVITED_USERS;
  const roster: InvitedTester[] = [];
  const alexCode = env.CARD_FLOW_INVITE_ALEX?.trim();
  const jordanCode = env.CARD_FLOW_INVITE_JORDAN?.trim();
  if (alexCode) roster.push({ userId: alex.userId, label: alex.label, inviteCode: alexCode });
  if (jordanCode) roster.push({ userId: jordan.userId, label: jordan.label, inviteCode: jordanCode });
  return roster;
}

/** Test-only codes; vitest sets these env vars (apps/api/vitest.config.ts). */
export const ALEX_INVITE_CODE = "alex-beta";
export const JORDAN_INVITE_CODE = "jordan-beta";

export function identityForInviteCode(inviteCode: string, env: Env = process.env): InvitedIdentity | null {
  return invitedIdentityByInviteCode(inviteCode, invitedTesters(env));
}
