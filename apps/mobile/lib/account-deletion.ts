import { runLocalAccountWipe } from "@cardflow/shared";
import { deleteAccount } from "./api";
import { gradeFlowSession } from "./grade-flow-session";
import { signOutLocally } from "./identity";
import { setAnalyticsEnabled } from "./product-events";
import { cardFlowQueryClient } from "./query-client";
import { clearScanQueue } from "./scan-queue";
import { clearWriteQueue } from "./write-queue";

/**
 * P4: delete the account on the server first. Only once that succeeds is the phone wiped,
 * so a failed request leaves everything as it was and the user can try again.
 */
export async function deleteAccountEverywhere(): Promise<{ photosDeleted: number; localFailed: string[] }> {
  const result = await deleteAccount();
  const { failed } = await runLocalAccountWipe({
    write_queue: () => clearWriteQueue(),
    scan_queue: () => clearScanQueue(),
    grade_flow: () => {
      gradeFlowSession.reset();
    },
    query_cache: () => cardFlowQueryClient.clear(),
    // Turning analytics off drops the unsent queue and the install ID tied to this account.
    analytics_install_id: () => setAnalyticsEnabled(false),
    session: () => signOutLocally(),
  });
  return { photosDeleted: result.photosDeleted, localFailed: failed };
}
