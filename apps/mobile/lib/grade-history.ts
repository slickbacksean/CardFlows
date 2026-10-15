import {
  appendGradeHistory,
  parseGradeHistory,
  type CardFlowGradeEstimate,
  type GradeHistoryEntry,
} from "@cardflow/shared";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { peekActiveUserId } from "./identity";

/** On-device pre-grade estimate history per card. */
const webMemory = new Map<string, string>();

function keyFor(inventoryItemId: string): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "_");
  return `cardflow.gradehist.${safe(peekActiveUserId())}.${safe(inventoryItemId)}`;
}

export async function loadGradeHistory(inventoryItemId: string): Promise<GradeHistoryEntry[]> {
  const key = keyFor(inventoryItemId);
  try {
    const raw = Platform.OS === "web" ? (webMemory.get(key) ?? null) : await SecureStore.getItemAsync(key);
    return parseGradeHistory(raw);
  } catch {
    return [];
  }
}

export async function recordGradeHistory(
  inventoryItemId: string,
  estimate: CardFlowGradeEstimate,
): Promise<GradeHistoryEntry[]> {
  const current = await loadGradeHistory(inventoryItemId);
  const next = appendGradeHistory(current, estimate, new Date().toISOString());
  if (next.length === current.length && next[next.length - 1] === current[current.length - 1]) return current;
  const key = keyFor(inventoryItemId);
  try {
    if (Platform.OS === "web") webMemory.set(key, JSON.stringify(next));
    else await SecureStore.setItemAsync(key, JSON.stringify(next));
  } catch {
    return current;
  }
  return next;
}
