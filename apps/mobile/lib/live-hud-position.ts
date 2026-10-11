import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  LIVESTREAM_HUD_POSITION_KEY,
  defaultLivestreamHudSavedPosition,
  parseLivestreamHudPosition,
  serializeLivestreamHudPosition,
  type LivestreamHudSavedPosition,
} from "@cardflow/shared";

const webMemory = new Map<string, string>();
let cached: LivestreamHudSavedPosition | null = null;

function isWeb(): boolean {
  return Platform.OS === "web";
}

function webStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function peekLivestreamHudPosition(): LivestreamHudSavedPosition {
  return cached ?? defaultLivestreamHudSavedPosition();
}

export async function loadLivestreamHudPosition(): Promise<LivestreamHudSavedPosition> {
  let raw: string | null = null;
  if (isWeb()) {
    raw = webStorage()?.getItem(LIVESTREAM_HUD_POSITION_KEY) ?? webMemory.get(LIVESTREAM_HUD_POSITION_KEY) ?? null;
  } else {
    try {
      raw = await SecureStore.getItemAsync(LIVESTREAM_HUD_POSITION_KEY);
    } catch {
      raw = webMemory.get(LIVESTREAM_HUD_POSITION_KEY) ?? null;
    }
  }
  cached = parseLivestreamHudPosition(raw) ?? defaultLivestreamHudSavedPosition();
  return cached;
}

export async function persistLivestreamHudPosition(position: LivestreamHudSavedPosition): Promise<void> {
  cached = position;
  const raw = serializeLivestreamHudPosition(position);
  webMemory.set(LIVESTREAM_HUD_POSITION_KEY, raw);
  if (isWeb()) {
    webStorage()?.setItem(LIVESTREAM_HUD_POSITION_KEY, raw);
    return;
  }
  try {
    await SecureStore.setItemAsync(LIVESTREAM_HUD_POSITION_KEY, raw);
  } catch {
    // Process cache still has the last snapped edge.
  }
}
