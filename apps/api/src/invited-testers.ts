import {
  INVITED_USERS,
  invitedIdentityByInviteCode,
  type InvitedIdentity,
  type InvitedTester,
} from "@cardflow/shared";

type Env = NodeJS.Dict<string | undefined>;

function code(env: Env, key: string, fallback: string): string {
  const value = env[key]?.trim();
  return value ? value : fallback;
}

/** Server-only invite roster. Defaults stay out of the phone bundle. */
export function invitedTesters(env: Env = process.env): InvitedTester[] {
  const [alex, jordan] = INVITED_USERS;
  return [
    {
      userId: alex.userId,
      label: alex.label,
      inviteCode: code(env, "CARD_FLOW_INVITE_ALEX", "alex-beta"),
    },
    {
      userId: jordan.userId,
      label: jordan.label,
      inviteCode: code(env, "CARD_FLOW_INVITE_JORDAN", "jordan-beta"),
    },
  ];
}

export const ALEX_INVITE_CODE = "alex-beta";
export const JORDAN_INVITE_CODE = "jordan-beta";

export function identityForInviteCode(inviteCode: string, env: Env = process.env): InvitedIdentity | null {
  return invitedIdentityByInviteCode(inviteCode, invitedTesters(env));
}
