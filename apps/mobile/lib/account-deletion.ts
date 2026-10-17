import {
  accountDeletionOutcome,
  gradeFlowPhotoUris,
  runLocalAccountWipe,
  wipesPhone,
  type AccountDeletionOutcome,
  type LocalAccountWipeStep,
} from "@cardflow/shared";
import { Directory, File, Paths } from "expo-file-system";
import { apiErrorStatus, deleteAccount, listInventory } from "./api";
import { gradeFlowSession } from "./grade-flow-session";
import { deviceItemIds } from "./device-item-index";
import { clearLegacyGradeHistory } from "./grade-history";
import { peekActiveUserId, signOutLocally } from "./identity";
import { setAnalyticsEnabled } from "./product-events";
import { cardFlowQueryClient } from "./query-client";
import { clearScanQueue } from "./scan-queue";
import { clearWriteQueue } from "./write-queue";

/** Cache folders the camera, picker and manipulator write grade stills and crops into. */
const PHOTO_CACHE_DIRS = ["Camera", "ImagePicker", "ImageManipulator"];

function deleteGradePhotoFiles(uris: readonly string[]): void {
  for (const uri of uris) {
    const file = new File(uri);
    if (file.exists) file.delete();
  }
  for (const name of PHOTO_CACHE_DIRS) {
    const dir = new Directory(Paths.cache, name);
    if (dir.exists) dir.delete();
  }
}

/**
 * Item IDs for the on-phone grade history keys. Backend re-review M2: the phone's own index
 * (every item it has listed or opened) is the source, so a failed list (e.g. a 401 on a retried
 * delete) can't leave history behind; a fresh server list only adds to it.
 */
async function inventoryItemIdsForWipe(userId: string): Promise<string[]> {
  const ids = new Set(deviceItemIds(userId));
  try {
    const result = await listInventory();
    for (const item of result.items) ids.add(item.inventoryItemId);
  } catch {
    // The device index is enough.
  }
  return [...ids];
}

export interface AccountDeletionResult {
  outcome: AccountDeletionOutcome;
  localFailed: LocalAccountWipeStep[];
}

/**
 * P4: delete the account on the server first. Only once that succeeds (or the server says it
 * was already deleted: 410/401, Backend review H1) is the phone wiped, so a failed request
 * leaves everything as it was and the user can try again.
 */
export async function deleteAccountEverywhere(password?: string): Promise<AccountDeletionResult> {
  const userId = peekActiveUserId();
  const itemIds = await inventoryItemIdsForWipe(userId);
  const photoUris = gradeFlowPhotoUris(gradeFlowSession.getState());
  let outcome: AccountDeletionOutcome;
  try {
    await deleteAccount(password);
    outcome = "deleted";
  } catch (error) {
    const status = apiErrorStatus(error);
    if (status === null) throw error;
    outcome = accountDeletionOutcome(status, (error as { code?: string }).code ?? null);
  }
  if (!wipesPhone(outcome)) return { outcome, localFailed: [] };
  const { failed } = await runLocalAccountWipe({
    write_queue: () => clearWriteQueue(),
    scan_queue: () => clearScanQueue(),
    grade_photos: () => deleteGradePhotoFiles(photoUris),
    grade_flow: () => {
      gradeFlowSession.reset();
    },
    grade_history: () => clearLegacyGradeHistory(userId, itemIds),
    query_cache: () => cardFlowQueryClient.clear(),
    // Turning analytics off drops the unsent queue and the install ID tied to this account.
    analytics_install_id: () => setAnalyticsEnabled(false),
    session: () => signOutLocally(),
  });
  return { outcome, localFailed: failed };
}
