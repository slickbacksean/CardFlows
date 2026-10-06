import { type InvitedIdentity } from "@cardflow/shared";
import { createSession, getIdentity, listInventory } from "./api";
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

export async function redeemInviteCode(inviteCode: string): Promise<IdentitySession> {
  const result = await createSession(inviteCode);
  await persistSessionToken(result.token);
  const session = toSession(result);
  rememberIdentity(session.identity);
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
  rememberIdentity(null);
  return signedOut;
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
