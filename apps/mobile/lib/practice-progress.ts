import { parsePracticeState, type PracticeState } from "@cardflow/shared";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/** Local-only checklist progress (P1-22). Nothing here is sent to the API. */
const KEY = "cardflow.practice.progress";
let webMemory: string | null = null;

export async function loadPracticeProgress(): Promise<PracticeState> {
  try {
    const raw = Platform.OS === "web" ? webMemory : await SecureStore.getItemAsync(KEY);
    return parsePracticeState(raw);
  } catch {
    return parsePracticeState(null);
  }
}

export async function savePracticeProgress(state: PracticeState): Promise<void> {
  const raw = JSON.stringify(state);
  if (Platform.OS === "web") {
    webMemory = raw;
    return;
  }
  try {
    await SecureStore.setItemAsync(KEY, raw);
  } catch {
    // Progress is a convenience; losing it only means the checklist restarts.
  }
}
