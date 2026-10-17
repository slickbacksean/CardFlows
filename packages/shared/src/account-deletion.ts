/**
 * P4 account deletion (Apple 5.1.1(v), Google Play account deletion). The app's Settings >
 * Delete account calls POST /v1/account/delete, which removes every user_id row, the user's
 * photos and staged uploads, and signs out every session, then the app wipes what it kept on
 * the phone. The purchase ledger is anonymized, not deleted (aggregate counts only).
 */
export const ACCOUNT_DELETION_COPY = {
  settingsRow: "Delete account",
  title: "Delete your account",
  intro: "This permanently deletes your CardFlow account and everything in it. It can't be undone.",
  deletes: [
    "Your sign-in, email and password",
    "Every card in MyDEX, your Watchlist and your purchase details",
    "Your scans and card photos, including pre-grade estimate photos",
    "Pre-grade estimate history, sales, listing drafts and Max Buy rules",
    "Your CardSight choice and your 18+ confirmation",
  ],
  keeps:
    "Purchases you made on a marketplace aren't affected. CardFlow keeps only anonymous, aggregate counts with nothing that identifies you.",
  guestIntro: "This deletes your guest scans and photos from CardFlow now, instead of after 24 hours.",
  confirmPrompt: "Type DELETE to confirm.",
  confirmWord: "DELETE",
  confirmButton: "Delete account",
  deleting: "Deleting…",
  alertTitle: "Delete your account?",
  alertBody: "Everything listed will be deleted for good.",
  cancel: "Cancel",
  done: "Your account and its data were deleted.",
  failed: "Your account wasn't deleted. Nothing was removed. Try again.",
} as const;

/** The typed confirmation: case-insensitive, surrounding spaces ignored. */
export function isAccountDeletionConfirmed(typed: string): boolean {
  return typed.trim().toUpperCase() === ACCOUNT_DELETION_COPY.confirmWord;
}

/**
 * What the app clears on the phone after the server says the account is gone, in order.
 * Every step runs even if one fails (each is best effort; the server data is already gone).
 */
export const LOCAL_ACCOUNT_WIPE_STEPS = [
  "write_queue",
  "scan_queue",
  "grade_flow",
  "query_cache",
  "analytics_install_id",
  "session",
] as const;
export type LocalAccountWipeStep = (typeof LOCAL_ACCOUNT_WIPE_STEPS)[number];

export async function runLocalAccountWipe(
  steps: Record<LocalAccountWipeStep, () => void | Promise<void>>,
): Promise<{ failed: LocalAccountWipeStep[] }> {
  const failed: LocalAccountWipeStep[] = [];
  for (const step of LOCAL_ACCOUNT_WIPE_STEPS) {
    try {
      await steps[step]();
    } catch {
      failed.push(step);
    }
  }
  return { failed };
}
