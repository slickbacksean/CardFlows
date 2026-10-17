/**
 * P4 account deletion (Apple 5.1.1(v), Google Play account deletion). The app's Settings >
 * Delete account calls POST /v1/account/delete, which removes every user_id row, the user's
 * photos and staged uploads, and signs out every session, then the app wipes what it kept on
 * the phone. The purchase ledger rows are deleted after their weekly counts are kept as anonymous
 * totals (north_star_weekly_totals: week and counts, no IDs).
 */
/** Policy Reviewer (P4): exact wording, also in the privacy policy draft. */
export const POKECOLLECTOR_DELETION_LINE =
  "If your account was linked to PokéCollector, CardFlow deletes the cards and wishlist it stored there and removes the link.";
/** Policy Reviewer (P4): exact wording for the anonymous North Star totals (Backend H2). */
export const ANONYMOUS_LEDGER_LINE =
  "CardFlow keeps only anonymous totals that can't identify you. Purchases you made on a marketplace aren't affected.";

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
    POKECOLLECTOR_DELETION_LINE,
  ],
  keeps: ANONYMOUS_LEDGER_LINE,
  /** Backend review M3 (P4): exact wording. */
  subscription: "Deleting your account doesn't cancel an App Store or Google Play subscription. Cancel it in your store settings.",
  credits: "Unused grading credits are lost and can't be refunded or restored.",
  /** Backend review M4: accounts with a password confirm with it; guests and testers type DELETE. */
  passwordPrompt: "Enter your password to confirm.",
  passwordLabel: "Password",
  passwordRequired: "Enter your password to delete your account.",
  passwordIncorrect: "That password isn't right. Your account wasn't deleted.",
  /** Backend review H1: the account was already gone (a retried delete). */
  alreadyDeleted: "Your account was already deleted. This phone has been cleared.",
  /** 401: no session any more (not provably deleted). The phone is still cleared. */
  signedOut:
    "You're signed out, and CardFlow's data on this phone was cleared. If your account still exists, sign in and delete it again.",
  /** Backend review M2: some on-phone data couldn't be cleared. */
  localFailed:
    "Your account was deleted, but some data on this phone couldn't be cleared. To remove it, delete and reinstall CardFlow.",
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
  // Backend review M2: the grade-flow photo files (camera stills, crops, freeze frame) go before
  // the session state that points at them is reset (reset() alone only clears memory).
  "grade_photos",
  "grade_flow",
  // Backend review M2: SecureStore cardflow.gradehist.<userId>.<itemId> (pre-server history).
  "grade_history",
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

/**
 * Backend review H1 (P4): what a delete response means. 410 = this token already deleted the
 * account (the first response was lost). 401 = no session any more: the phone is wiped and
 * signed out too (nothing is left to delete with this token), but the copy doesn't claim the
 * account is gone, since an expired session also answers 401.
 * 403 (password) and anything else = nothing was deleted.
 */
export type AccountDeletionOutcome =
  | "deleted"
  | "already_deleted"
  | "signed_out"
  | "password_required"
  | "password_incorrect"
  | "failed";

export function accountDeletionOutcome(status: number, code?: string | null): AccountDeletionOutcome {
  if (status >= 200 && status < 300) return "deleted";
  if (status === 410) return "already_deleted";
  if (status === 401) return "signed_out";
  if (status === 403 && code === "password_required") return "password_required";
  if (status === 403 && code === "password_incorrect") return "password_incorrect";
  return "failed";
}

/** Whether the phone is wiped for this outcome. */
export function wipesPhone(outcome: AccountDeletionOutcome): boolean {
  return outcome === "deleted" || outcome === "already_deleted" || outcome === "signed_out";
}

/** Backend review M2: every local file the grade flow holds (stills, crops, freeze frame). */
export function gradeFlowPhotoUris(state: {
  front: { uri: string; cropUri: string | null } | null;
  back: { uri: string; cropUri: string | null } | null;
  freezeUri: string | null;
}): string[] {
  const uris = [state.front?.uri, state.front?.cropUri, state.back?.uri, state.back?.cropUri, state.freezeUri];
  return [...new Set(uris.filter((uri): uri is string => typeof uri === "string" && uri.length > 0))];
}

/** Backend review M2: the SecureStore key grade-history.ts used for on-phone history. */
export function legacyGradeHistoryKey(userId: string, inventoryItemId: string): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "_");
  return `cardflow.gradehist.${safe(userId)}.${safe(inventoryItemId)}`;
}
