import { checkAge, type AgeCheck } from "@cardflow/shared";
import * as SecureStore from "expo-secure-store";
import { confirmAgeOnServer, deleteCurrentUserData, getAgeConfirmation } from "./api";
import { setAnalyticsEnabled } from "./product-events";
import { peekSessionToken, persistSessionToken, setSessionToken } from "./session-token";

/**
 * Sean: CardFlow is 18+ only. Policy Reviewer: birth month and year are checked here on the
 * phone and thrown away; the server gets only "confirmed 18+" and the gate version. Under 18,
 * nothing is uploaded or sent (no scan, sign-up, CardSight or analytics), any guest data is
 * deleted, and the phone remembers the lockout.
 */
const LOCKOUT_KEY = "cardflow.age.lockout.v1";

let lockedOut: boolean | null = null;
let confirmedFor: string | null = null;
let confirmedWithoutSession = false;
let pending: { resolve: (ok: boolean) => void } | null = null;
let opener: (() => void) | null = null;
const lockoutListeners = new Set<() => void>();

/** The root layout swaps the whole app for the under-18 message. */
export function onAgeLockout(listener: () => void): () => void {
  lockoutListeners.add(listener);
  return () => lockoutListeners.delete(listener);
}

export async function loadAgeLockout(): Promise<boolean> {
  if (lockedOut === null) lockedOut = (await SecureStore.getItemAsync(LOCKOUT_KEY).catch(() => null)) === "1";
  return lockedOut;
}

export function isAgeLockedOut(): boolean {
  return lockedOut === true;
}

/** The root layout registers how to open the gate screen. */
export function registerAgeGateOpener(open: () => void): () => void {
  opener = open;
  return () => {
    if (opener === open) opener = null;
  };
}

/** True when this session still has to answer (server-side state; unknown = ask). */
export async function needsAgeGate(userKey: string): Promise<boolean> {
  if (await loadAgeLockout()) return true;
  if (confirmedFor === userKey) return false;
  if (!peekSessionToken()) return !confirmedWithoutSession;
  try {
    const { age } = await getAgeConfirmation();
    if (age.confirmed) confirmedFor = userKey;
    return !age.confirmed;
  } catch {
    return true;
  }
}

/**
 * Before the first upload (and before sign-up): shows the gate if needed and resolves true only
 * for a confirmed adult. Comes before the CardSight prompt.
 */
export async function ensureAgeConfirmed(userKey: string): Promise<boolean> {
  if (await loadAgeLockout()) return false;
  if (!(await needsAgeGate(userKey))) return true;
  if (!opener) return false;
  pending?.resolve(false);
  return new Promise<boolean>((resolve) => {
    pending = { resolve };
    opener?.();
  });
}

/** A different user (sign-in, invite) is checked again. */
export function resetAgeGateCache(): void {
  confirmedFor = null;
}

/** The gate screen closed without an answer. */
export function cancelAgeGate(): void {
  pending?.resolve(false);
  pending = null;
}

/**
 * The gate screen's Continue. The month and year are used for this check only and are not kept.
 * Returns the result so the screen can show the under-18 message.
 */
export async function submitAgeGate(
  who: { userKey: string; isGuest: boolean },
  birthMonth: number | null,
  birthYear: number | null,
): Promise<AgeCheck> {
  const { userKey } = who;
  const result = checkAge(birthMonth, birthYear);
  if (result === "invalid") return result;
  if (result === "under_18") {
    await lockOutUnderAge({ isGuest: who.isGuest });
    pending?.resolve(false);
    pending = null;
    return result;
  }
  if (peekSessionToken()) {
    try {
      await confirmAgeOnServer();
    } catch {
      return "invalid";
    }
  } else {
    confirmedWithoutSession = true;
  }
  confirmedFor = userKey;
  pending?.resolve(true);
  pending = null;
  return result;
}

/**
 * Under 18: remember it on this phone, turn analytics off (drops anything queued), delete the
 * guest's data on the server if there is a guest session (the request carries no age or birth
 * date), and forget the session so nothing else is sent. A signed-in account is signed out on
 * this phone but not deleted here (see the privacy draft: we delete it when we learn of it).
 */
export async function lockOutUnderAge(options: { isGuest: boolean }): Promise<void> {
  lockedOut = true;
  await SecureStore.setItemAsync(LOCKOUT_KEY, "1").catch(() => undefined);
  await setAnalyticsEnabled(false);
  if (peekSessionToken() && options.isGuest) {
    await deleteCurrentUserData().catch(() => undefined);
  }
  setSessionToken(null);
  await persistSessionToken(null);
  for (const listener of lockoutListeners) listener();
}
