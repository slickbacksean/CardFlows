/**
 * Sean (Oct 18): v1 identifies English cards only. Non-English prints (e.g. Japanese)
 * are shown with this note, can be skipped, and do not count toward the monthly scan
 * allowance — for single-card and multi-card scans alike.
 */

/** Exact copy for the confirm / multi-card list when CardSight reports a non-English print. */
export const ENGLISH_CARDS_ONLY_NOTE = "Only English cards are supported for now.";

/** Mapping lookup.method when auto-map rejects a non-English detection. */
export const ENGLISH_CARDS_ONLY_LOOKUP_METHOD = "language is not en; auto-map rejected";

export function isEnglishCardLanguage(language: string | null | undefined): boolean {
  if (!language) return true; // missing → treat as English (legacy MVP default)
  return language.trim().toLowerCase() === "en";
}

/** True when the provider reported a language and it is not English. */
export function isUnsupportedCardLanguage(language: string | null | undefined): boolean {
  if (!language || !language.trim()) return false;
  return language.trim().toLowerCase() !== "en";
}
