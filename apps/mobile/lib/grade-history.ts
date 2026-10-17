import {
  legacyGradeHistoryKey,
  parseGradeHistory,
  type CardFlowGradeEstimate,
  type GradeHistoryEntry,
} from "@cardflow/shared";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { getGradeHistory, isPremiumRequired } from "./api";
import { forgetDeviceItemIds, rememberDeviceItemIds } from "./device-item-index";
import { peekActiveUserId } from "./identity";
import { runQueueableWrite } from "./write-queue";

/**
 * P2-07 pre-grade estimate history lives on the server (per user); the API records
 * each fresh estimate itself. Entries kept on this phone before that are uploaded
 * once through the P1-09 offline queue, then removed.
 */
const webMemory = new Map<string, string>();
const lastSeen = new Map<string, GradeHistoryEntry[]>();

function legacyKey(inventoryItemId: string): string {
  return legacyGradeHistoryKey(peekActiveUserId(), inventoryItemId);
}

/**
 * Backend review M2 (P4): account deletion removes the on-phone history for every card the
 * account had. SecureStore can't list keys, so the item IDs come from the phone's own index
 * (device-item-index.ts, re-review M2) plus whatever the server listed before the delete.
 */
export async function clearLegacyGradeHistory(userId: string, inventoryItemIds: readonly string[]): Promise<void> {
  lastSeen.clear();
  lockedCount = 0;
  nextCursor = null;
  for (const id of inventoryItemIds) {
    const key = legacyGradeHistoryKey(userId, id);
    if (Platform.OS === "web") webMemory.delete(key);
    else await SecureStore.deleteItemAsync(key);
  }
  if (Platform.OS === "web") {
    for (const key of [...webMemory.keys()]) if (key.startsWith(legacyGradeHistoryKey(userId, ""))) webMemory.delete(key);
  }
  forgetDeviceItemIds(userId);
}

async function readLegacy(key: string): Promise<string | null> {
  try {
    return Platform.OS === "web" ? (webMemory.get(key) ?? null) : await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function clearLegacy(key: string): Promise<void> {
  try {
    if (Platform.OS === "web") webMemory.delete(key);
    else await SecureStore.deleteItemAsync(key);
  } catch {
    // Next open tries again; the server ignores duplicates.
  }
}

/** One-time upload of on-device history. Returns the legacy entries (for offline display). */
export async function migrateLocalGradeHistory(inventoryItemId: string): Promise<GradeHistoryEntry[]> {
  const key = legacyKey(inventoryItemId);
  const legacy = parseGradeHistory(await readLegacy(key));
  if (legacy.length === 0) return [];
  try {
    await runQueueableWrite("import_grade_history", {
      inventoryItemId,
      entries: legacy.map((entry) => ({ at: entry.at, overall: entry.overall, confidence: entry.confidence })),
    });
  } catch (error) {
    // Free accounts can't import (premium); keep the on-phone copy so nothing is lost.
    if (isPremiumRequired(error, "grade_history")) return legacy;
    // Other permanent refusal (e.g. card deleted): nothing to keep.
  }
  await clearLegacy(key);
  return legacy;
}

/** Free accounts: how many older estimates the server kept but didn't send (last load). */
let lockedCount = 0;
/** Premium: cursor for the next older page (null when everything is shown). */
let nextCursor: string | null = null;
export function gradeHistoryHasOlder(): boolean {
  return nextCursor !== null;
}

/** Premium: fetch the next older page and return the full list (older first). */
export async function loadOlderGradeHistory(inventoryItemId: string, current: GradeHistoryEntry[]): Promise<GradeHistoryEntry[]> {
  if (!nextCursor) return current;
  const result = await getGradeHistory(inventoryItemId, nextCursor);
  nextCursor = result.nextCursor ?? null;
  const older = result.history.map((entry) => ({ at: entry.at, overall: entry.overall, confidence: entry.confidence }));
  const merged = [...older, ...current];
  lastSeen.set(`${peekActiveUserId()}|${inventoryItemId}`, merged);
  return merged;
}
export function gradeHistoryLockedCount(): number {
  return lockedCount;
}

export async function loadGradeHistory(inventoryItemId: string): Promise<GradeHistoryEntry[]> {
  rememberDeviceItemIds([inventoryItemId]);
  const legacy = await migrateLocalGradeHistory(inventoryItemId);
  const cacheKey = `${peekActiveUserId()}|${inventoryItemId}`;
  try {
    const result = await getGradeHistory(inventoryItemId);
    const history = result.history;
    lockedCount = result.lockedCount ?? 0;
    nextCursor = result.nextCursor ?? null;
    const entries = history.map((entry) => ({ at: entry.at, overall: entry.overall, confidence: entry.confidence }));
    // If the import is still queued, show the legacy entries until it lands.
    const shown = entries.length === 0 && legacy.length > 0 ? legacy : entries;
    lastSeen.set(cacheKey, shown);
    return shown;
  } catch (error) {
    return lastSeen.get(cacheKey) ?? legacy;
  }
}

/** The API already recorded the estimate; refresh the list from the server. */
export async function recordGradeHistory(
  inventoryItemId: string,
  estimate: CardFlowGradeEstimate,
): Promise<GradeHistoryEntry[]> {
  void estimate;
  return loadGradeHistory(inventoryItemId);
}
