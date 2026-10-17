import { isGuestUserId, type InvitedIdentity } from "@cardflow/shared";
import { createAccount, createGuestSession, createSession, getIdentity, listInventory, signInWithPassword } from "./api";
import { resetAgeConfirmationCache } from "./age-confirmation";
import { resetCardSightConsentCache } from "./cardsight-consent";
import { stopLiveVideoIdentify } from "./live-identify";
import { clearLivestreamOverlay } from "./livestream";
import {
  loadPersistedSessionToken,
  persistSessionToken,
  registerSessionRestore,
  setSessionToken,
  withSessionBootstrap,
} from "./session-token";

interface IdentitySession {
  identity: InvitedIdentity | null;
  invitedUsers: InvitedIdentity[];
  /** Open sign-up accounts: false until the emailed code is confirmed. */
  emailVerified?: boolean;
}

let cachedUserId: string | null = null;
let restorePromise: Promise<IdentitySession> | null = null;

export function peekActiveUserId(): string {
  return cachedUserId ?? "";
}

function rememberIdentity(identity: InvitedIdentity | null) {
  cachedUserId = identity?.userId ?? null;
}

function toSession(result: {
  identity?: InvitedIdentity | null;
  invitedUsers?: InvitedIdentity[];
}): IdentitySession {
  const identity = result.identity ?? null;
  return {
    identity,
    invitedUsers: identity ? [identity] : [],
  };
}

const signedOut: IdentitySession = { identity: null, invitedUsers: [] };

/** Drop a stored invite token only when the API rejects it. A restart or timeout must keep it. */
export function shouldClearStoredSession(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

function requestStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/** Open sign-up / sign-in. The guest bearer rides along so the API moves the guest's scans. */
export async function signUpWithEmail(
  email: string,
  password: string,
  mode: "sign_up" | "sign_in",
  ageConfirmed18Plus = false,
): Promise<IdentitySession> {
  const result = mode === "sign_up" ? await createAccount(email, password, ageConfirmed18Plus) : await signInWithPassword(email, password);
  await persistSessionToken(result.token);
  setSessionToken(result.token);
  const session = { ...toSession(result), emailVerified: result.emailVerified };
  rememberIdentity(session.identity);
  // A guest's CardSight answer moves with the account; anyone else is re-checked on next upload.
  resetCardSightConsentCache();
  resetAgeConfirmationCache();
  restorePromise = Promise.resolve(session);
  return session;
}

export async function redeemInviteCode(inviteCode: string): Promise<IdentitySession> {
  const result = await createSession(inviteCode);
  await persistSessionToken(result.token);
  const session = toSession(result);
  rememberIdentity(session.identity);
  // A guest's CardSight answer moves with the account; anyone else is re-checked on next upload.
  resetCardSightConsentCache();
  resetAgeConfirmationCache();
  restorePromise = Promise.resolve(session);
  stopLiveVideoIdentify();
  clearLivestreamOverlay();
  return session;
}

async function restoreIdentitySession(): Promise<IdentitySession> {
  const stored = await loadPersistedSessionToken();
  if (stored) {
    setSessionToken(stored);
    try {
      const restored = toSession(await getIdentity());
      if (restored.identity) {
        rememberIdentity(restored.identity);
        return restored;
      }
    } catch (error) {
      if (!shouldClearStoredSession(requestStatus(error))) throw error;
    }
    setSessionToken(null);
    await persistSessionToken(null);
  }
  // D9: no stored session -> try a guest session (3 free scans). 404 = guest mode is off.
  try {
    const guest = await createGuestSession();
    setSessionToken(guest.token);
    await persistSessionToken(guest.token);
    rememberIdentity(guest.identity);
    return { identity: guest.identity, invitedUsers: [] };
  } catch {
    rememberIdentity(null);
    return signedOut;
  }
}

/** D9: true while the app runs on a guest session. */
export function isGuestSession(): boolean {
  return isGuestUserId(cachedUserId);
}

export async function ensureIdentitySession(): Promise<IdentitySession> {
  if (!restorePromise) {
    restorePromise = withSessionBootstrap(restoreIdentitySession).catch((error) => {
      restorePromise = null;
      throw error;
    });
  }
  return restorePromise;
}

registerSessionRestore(async () => {
  await ensureIdentitySession();
});

export async function loadIdentitySession(): Promise<IdentitySession> {
  return ensureIdentitySession();
}

export async function loadActiveIdentity(): Promise<InvitedIdentity | null> {
  const session = await loadIdentitySession();
  return session.identity;
}

export async function currentInventoryCount(): Promise<number> {
  const result = await listInventory();
  return result.items.length;
}

export async function switchActiveIdentity(inviteCode: string): Promise<IdentitySession> {
  return redeemInviteCode(inviteCode);
}
