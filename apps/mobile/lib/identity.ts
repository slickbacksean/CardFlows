import { isGuestUserId, type InvitedIdentity } from "@cardflow/shared";
import { createAccount, getIdentity, listInventory, signInWithPassword, signInWithSocialToken } from "./api";
import { resetAgeConfirmationCache } from "./age-confirmation";
import { setDeviceItemIndexOwner } from "./device-item-index";
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
/** Sean (Oct 19): Apple/Google-only accounts have no password (false from the server). */
let cachedHasPassword: boolean | undefined;
let restorePromise: Promise<IdentitySession> | null = null;

type AuthListener = (userId: string | null) => void;
const authListeners = new Set<AuthListener>();

function notifyAuthListeners() {
  for (const listener of authListeners) listener(cachedUserId);
}

/** Subscribe to signed-in user id changes (null when signed out). */
export function subscribeAuth(listener: AuthListener): () => void {
  authListeners.add(listener);
  listener(cachedUserId);
  return () => {
    authListeners.delete(listener);
  };
}

export function peekActiveUserId(): string {
  return cachedUserId ?? "";
}

function rememberIdentity(identity: InvitedIdentity | null) {
  cachedUserId = identity?.userId ?? null;
  setDeviceItemIndexOwner(cachedUserId);
  notifyAuthListeners();
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

/** Drop a stored session token only when the API rejects it. A restart or timeout must keep it. */
export function shouldClearStoredSession(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

function requestStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/** True when the session is a signed-up account (not a guest, not empty). */
export function isSignedInIdentity(identity: InvitedIdentity | null | undefined): boolean {
  return !!identity?.userId && !isGuestUserId(identity.userId);
}

/** Open sign-up / sign-in. */
export async function signUpWithEmail(
  email: string,
  password: string,
  mode: "sign_up" | "sign_in",
  ageConfirmed18Plus = false,
  termsAccepted = false,
  creatorCode?: string,
): Promise<IdentitySession> {
  const result = mode === "sign_up" ? await createAccount(email, password, ageConfirmed18Plus, termsAccepted, creatorCode) : await signInWithPassword(email, password, termsAccepted);
  cachedHasPassword = (result as { hasPassword?: boolean }).hasPassword ?? true;
  return adoptSession(result);
}

/**
 * Sean (Oct 19): Sign in with Apple / Google. A first-time sign-in without the 18+ and Terms
 * checkboxes fails with code `signup_details_required` (no account is created).
 */
export async function signInWithSocial(input: Parameters<typeof signInWithSocialToken>[0]): Promise<IdentitySession> {
  const result = await signInWithSocialToken(input);
  cachedHasPassword = (result as { hasPassword?: boolean }).hasPassword ?? false;
  return adoptSession(result);
}

async function adoptSession(result: Awaited<ReturnType<typeof signInWithPassword>>): Promise<IdentitySession> {
  await persistSessionToken(result.token);
  setSessionToken(result.token);
  const session = { ...toSession(result), emailVerified: result.emailVerified };
  rememberIdentity(session.identity);
  resetCardSightConsentCache();
  resetAgeConfirmationCache();
  restorePromise = Promise.resolve(session);
  return session;
}


async function restoreIdentitySession(): Promise<IdentitySession> {
  const stored = await loadPersistedSessionToken();
  if (stored) {
    setSessionToken(stored);
    try {
      const raw = await getIdentity();
      cachedHasPassword = (raw as { hasPassword?: boolean }).hasPassword;
      const restored = toSession(raw);
      if (restored.identity && isSignedInIdentity(restored.identity)) {
        rememberIdentity(restored.identity);
        return restored;
      }
      // Leftover guest token (retired browse-only path): clear and treat as signed out.
    } catch (error) {
      if (!shouldClearStoredSession(requestStatus(error))) throw error;
    }
    setSessionToken(null);
    await persistSessionToken(null);
  }
  rememberIdentity(null);
  return signedOut;
}

/**
 * Forget the session on this phone. The next screen is sign in / sign up (no guest session).
 */
export async function signOutLocally(): Promise<void> {
  cachedHasPassword = undefined;
  setSessionToken(null);
  await persistSessionToken(null);
  rememberIdentity(null);
  restorePromise = null;
  resetCardSightConsentCache();
  resetAgeConfirmationCache();
  stopLiveVideoIdentify();
  clearLivestreamOverlay();
}

/** True only for a leftover guest_… id; the app no longer creates these. */
export function isGuestSession(): boolean {
  return isGuestUserId(cachedUserId);
}

/** Signed-up accounts (`acct_…`) have a password. */
export function isPasswordAccountSession(): boolean {
  if (cachedHasPassword === false) return false;
  return typeof cachedUserId === "string" && cachedUserId.startsWith("acct_");
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

