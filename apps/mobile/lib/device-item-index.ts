import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";

/**
 * Backend re-review M2 (P4): inventory item IDs this phone has seen, per user, kept on the device.
 * Account deletion uses them to find the on-phone grade history keys (SecureStore can't list
 * keys), so the wipe still works when listing inventory fails (e.g. a 401 on a retried delete).
 * Only opaque item IDs are stored, never card names, prices or photos.
 *
 * Re-review L1: the file lives in the cache directory, which iOS and Android leave out of
 * device backups (the OS may also clear it; the wipe then still has the server's list). Capped at
 * the newest MAX_IDS_PER_USER (5,000) IDs per user: on-phone history for older items beyond that
 * is only found through the server's list.
 */
const INDEX_FILE = "cardflow-item-index.json";
export const MAX_IDS_PER_USER = 5000;
let webIndex: Record<string, string[]> = {};
let owner = "";

function indexFile(): File {
  return new File(Paths.cache, INDEX_FILE);
}

/** Builds before re-review L1 wrote the index to the document directory (backed up). */
function legacyIndexFile(): File {
  return new File(Paths.document, INDEX_FILE);
}

function parseIndex(text: string): Record<string, string[]> {
  const parsed = JSON.parse(text) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string[]>) : {};
}

function readIndex(): Record<string, string[]> {
  if (Platform.OS === "web") return webIndex;
  try {
    const file = indexFile();
    if (file.exists) return parseIndex(file.textSync());
    const legacy = legacyIndexFile();
    if (!legacy.exists) return {};
    // Move it out of the backed-up directory once.
    const moved = parseIndex(legacy.textSync());
    legacy.delete();
    writeIndex(moved);
    return moved;
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

/**
 * Account deletion: the user's entry goes with the rest of the phone wipe. Re-review L1: the owner
 * is cleared too, so an inventory list still in flight (or a refetch) can't write it back.
 */
export function forgetDeviceItemIds(userId: string): void {
  if (owner === userId) owner = "";
  const index = readIndex();
  if (!(userId in index)) return;
  delete index[userId];
  writeIndex(index);
}
