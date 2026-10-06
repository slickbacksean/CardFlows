export interface InvitedIdentity {
  userId: string;
  label: string;
}

/** Documented private-beta invite. Codes live on the API, not in this package. */
export interface InvitedTester extends InvitedIdentity {
  inviteCode: string;
}

function toInvitedIdentity(user: InvitedIdentity): InvitedIdentity {
  return { userId: user.userId, label: user.label };
}

function normalizeInviteCode(inviteCode: string): string {
  return inviteCode.trim().toLowerCase();
}

const ALEX: InvitedIdentity = {
  userId: "9f1a2b3c-4d5e-6789-abcd-ef0123456789",
  label: "alex@cardflow.beta",
};

const JORDAN: InvitedIdentity = {
  userId: "7e2c3d4e-5f60-789a-bcde-f01234567891",
  label: "jordan@cardflow.beta",
};

export const INVITED_USERS = [ALEX, JORDAN] as const;

export const DEFAULT_INVITED_IDENTITY = ALEX;
export const DEFAULT_INVITED_USER = DEFAULT_INVITED_IDENTITY;
export const DEFAULT_INVITED_USER_ID = ALEX.userId;

export function listInvitedIdentities(): InvitedIdentity[] {
  return INVITED_USERS.map(toInvitedIdentity);
}

export function invitedIdentityByUserId(userId: string): InvitedIdentity | null {
  const user = INVITED_USERS.find((item) => item.userId === userId);
  return user ? toInvitedIdentity(user) : null;
}

export function inviteCodeForUserId(
  userId: string,
  testers: readonly InvitedTester[],
): string | null {
  return testers.find((item) => item.userId === userId)?.inviteCode ?? null;
}

export function invitedIdentityByInviteCode(
  inviteCode: string,
  testers: readonly InvitedTester[],
): InvitedIdentity | null {
  const normalized = normalizeInviteCode(inviteCode);
  if (!normalized) return null;
  const user = testers.find((item) => normalizeInviteCode(item.inviteCode) === normalized);
  return user ? toInvitedIdentity(user) : null;
}

export function isInvitedUserId(userId: string): boolean {
  return INVITED_USERS.some((user) => user.userId === userId);
}

export function requireInvitedIdentity(userId: string): InvitedIdentity {
  const identity = invitedIdentityByUserId(userId);
  if (!identity) throw new Error("Unknown invited user");
  return identity;
}

/** Stable PokéCollector username for an invited tester. Server-side only. */
export function pokecollectorUsernameForIdentity(identity: InvitedIdentity): string {
  const local = identity.label.split("@")[0]?.trim().toLowerCase() || "tester";
  const slug = local.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tester";
  return `cardflow-${slug}`;
}

export const ACCOUNT_SWITCH_SECTION_LABEL = "Invited testers";
export const ACCOUNT_SWITCH_CONFIRM_TITLE = "Switch tester?";
export const ACCOUNT_SWITCH_CONFIRM_MESSAGE =
  "Collection will show the other tester's inventory. This tester's copies are not deleted.";
export const ACCOUNT_SWITCH_CONFIRM_ACTION = "Switch tester";
export const ACCOUNT_SWITCH_STAY_ACTION = "Stay";

/** WIREFRAMES.md §10c — private beta is not a HoloDex-style account wall. */
export const CAPTURE_REQUIRES_LOGIN: false = false;
export const SIGN_UP_WALL_ENABLED: false = false;
export const NOT_THIS_TESTER_LABEL = "Not this tester";

export function identityAfterNotThisTester(): InvitedIdentity {
  return {
    userId: DEFAULT_INVITED_IDENTITY.userId,
    label: DEFAULT_INVITED_IDENTITY.label,
  };
}

export function shouldConfirmAccountSwitch(input: {
  currentUserId: string | null;
  nextUserId: string;
  currentInventoryCount: number | null;
}): boolean {
  if (!input.currentUserId || input.currentUserId === input.nextUserId) return false;
  if (input.currentInventoryCount === null) return true;
  return input.currentInventoryCount > 0;
}

export function crmRowsForUser<T extends { userId: string }>(
  rows: readonly T[],
  userId: string,
): T[] {
  return rows.filter((row) => row.userId === userId);
}

export function crmValueForUser<T extends { userId: string }>(
  value: T | null | undefined,
  userId: string | null,
): T | null {
  if (!value || !userId || value.userId !== userId) return null;
  return value;
}

const PRIVATE_BETA_IDP_PATTERNS = [
  { id: "apple", pattern: /sign in with apple/i },
  { id: "google", pattern: /sign in with google/i },
  { id: "clerk", pattern: /\bclerk\b/i },
  { id: "auth0", pattern: /\bauth0\b/i },
  { id: "magic_link", pattern: /magic link/i },
  { id: "email_password", pattern: /email\/password/i },
  { id: "marketplace_oauth", pattern: /marketplace oauth/i },
] as const;

const SIGN_UP_WALL_PATTERNS = [
  { id: "sign_up_to_continue", pattern: /sign up to (continue|scan)|create (an )?account/i },
  { id: "please_sign_in", pattern: /please (log|sign) in|login required|must (log|sign) in/i },
] as const;

export function forbiddenPrivateBetaIdp(copy: string): string | null {
  for (const item of PRIVATE_BETA_IDP_PATTERNS) {
    if (item.pattern.test(copy)) return item.id;
  }
  return null;
}

export function forbiddenSignUpWall(copy: string): string | null {
  const idp = forbiddenPrivateBetaIdp(copy);
  if (idp) return idp;
  for (const item of SIGN_UP_WALL_PATTERNS) {
    if (item.pattern.test(copy)) return item.id;
  }
  return null;
}
