import {
  parseGradeHistory,
  type CardFlowGradeEstimate,
  type GradeHistoryEntry,
} from "@cardflow/shared";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { getGradeHistory } from "./api";
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
  const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "_");
  return `cardflow.gradehist.${safe(peekActiveUserId())}.${safe(inventoryItemId)}`;
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
  } catch {
    // Permanent refusal (e.g. card deleted): nothing to keep.
  }
  await clearLegacy(key);
  return legacy;
}

export async function loadGradeHistory(inventoryItemId: string): Promise<GradeHistoryEntry[]> {
  const legacy = await migrateLocalGradeHistory(inventoryItemId);
  const cacheKey = `${peekActiveUserId()}|${inventoryItemId}`;
  try {
    const { history } = await getGradeHistory(inventoryItemId);
    const entries = history.map((entry) => ({ at: entry.at, overall: entry.overall, confidence: entry.confidence }));
    // If the import is still queued, show the legacy entries until it lands.
    const shown = entries.length === 0 && legacy.length > 0 ? legacy : entries;
    lastSeen.set(cacheKey, shown);
    return shown;
  } catch {
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
