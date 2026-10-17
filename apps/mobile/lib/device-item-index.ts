import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";

/**
 * Backend re-review M2 (P4): inventory item IDs this phone has seen, per user, kept on the device.
 * Account deletion uses them to find the on-phone grade history keys (SecureStore can't list
 * keys), so the wipe still works when listing inventory fails (e.g. a 401 on a retried delete).
 * Only opaque item IDs are stored, never card names, prices or photos.
 */
const INDEX_FILE = "cardflow-item-index.json";
const MAX_IDS_PER_USER = 5000;
let webIndex: Record<string, string[]> = {};
let owner = "";

function indexFile(): File {
  return new File(Paths.document, INDEX_FILE);
}

function readIndex(): Record<string, string[]> {
  if (Platform.OS === "web") return webIndex;
  try {
    const file = indexFile();
    if (!file.exists) return {};
    const parsed = JSON.parse(file.textSync()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function writeIndex(next: Record<string, string[]>): void {
  if (Platform.OS === "web") {
    webIndex = next;
    return;
  }
  try {
    const file = indexFile();
    if (Object.keys(next).length === 0) {
      if (file.exists) file.delete();
      return;
    }
    if (!file.exists) file.create();
    file.write(JSON.stringify(next));
  } catch {
    // Best effort: the delete still tries the server's inventory list.
  }
}

/** identity.ts calls this whenever the signed-in user changes. */
export function setDeviceItemIndexOwner(userId: string | null): void {
  owner = userId ?? "";
}

/** Remembers item IDs for the current user (from inventory lists and grade history). */
export function rememberDeviceItemIds(ids: readonly string[]): void {
  if (!owner || ids.length === 0) return;
  const index = readIndex();
  const known = new Set(index[owner] ?? []);
  const before = known.size;
  for (const id of ids) if (id) known.add(id);
  if (known.size === before) return;
  index[owner] = [...known].slice(-MAX_IDS_PER_USER);
  writeIndex(index);
}

export function deviceItemIds(userId: string): string[] {
  return [...(readIndex()[userId] ?? [])];
}

/** Account deletion: the user's entry goes with the rest of the phone wipe. */
export function forgetDeviceItemIds(userId: string): void {
  const index = readIndex();
  if (!(userId in index)) return;
  delete index[userId];
  writeIndex(index);
}
