import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SESSION_TOKEN_KEY = "cardflow.session.token";

const webMemory = new Map<string, string>();
let memoryToken: string | null = null;
let bootstrapCount = 0;
let restoreGate: (() => Promise<void>) | null = null;

function isWeb(): boolean {
  return Platform.OS === "web";
}

export function peekSessionToken(): string | null {
  return memoryToken;
}

export function setSessionToken(token: string | null): void {
  memoryToken = token;
}

export function registerSessionRestore(restore: () => Promise<void>): void {
  restoreGate = restore;
}

export async function withSessionBootstrap<T>(work: () => Promise<T>): Promise<T> {
  bootstrapCount += 1;
  try {
    return await work();
  } finally {
    bootstrapCount -= 1;
  }
}

export async function waitForSessionRestore(): Promise<void> {
  if (bootstrapCount > 0) return;
  if (!restoreGate) {
    await import("./identity");
  }
  if (restoreGate) await restoreGate();
}

function webStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export async function loadPersistedSessionToken(): Promise<string | null> {
  if (isWeb()) return webStorage()?.getItem(SESSION_TOKEN_KEY) ?? webMemory.get(SESSION_TOKEN_KEY) ?? null;
  try {
    return await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
  } catch {
    return memoryToken;
  }
}

export async function persistSessionToken(token: string | null): Promise<void> {
  memoryToken = token;
  if (isWeb()) {
    const storage = webStorage();
    if (token) {
      webMemory.set(SESSION_TOKEN_KEY, token);
      storage?.setItem(SESSION_TOKEN_KEY, token);
    } else {
      webMemory.delete(SESSION_TOKEN_KEY);
      storage?.removeItem(SESSION_TOKEN_KEY);
    }
    return;
  }
  try {
    if (token) await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  } catch {
    // Native store unavailable; this process still has the in-memory token.
  }
}
