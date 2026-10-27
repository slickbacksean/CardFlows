/**
 * Sean (Oct 25): Training capture utilities ported from PR 117.
 * PokeSniper keeps Scan a Card photos of cards the user confirms, to train PokeSniper's OWN card
 * scanner. Consent is part of the Terms accepted at sign-up, with an opt-out in Settings.
 * 
 * Safeguards:
 * - Live Scan stream frames are never kept (Whatnot's terms).
 * - Grade photos are not kept beyond the existing 24 h policy.
 * - Guests and accounts that haven't confirmed 18+ are never captured.
 * - CardSight outputs are never stored as labels: a sample is kept only when the confirmed card came
 *   from PokeSniper's own matcher or the user's manual search. CardSight-assisted confirms are
 *   classified `cardsight_assisted` and are not kept (and the export excludes them regardless).
 */

/** Default days a training photo is kept (CARD_FLOW_TRAINING_RETENTION_DAYS overrides). */
export const TRAINING_RETENTION_DAYS_DEFAULT = 180;

export type TrainingLabelSource = "in_house_suggestion" | "manual_search" | "cardsight_assisted";

/** Label sources the export (and the trainer) may use. Never cardsight_assisted. */
export const TRAINING_ELIGIBLE_LABEL_SOURCES: readonly TrainingLabelSource[] = ["in_house_suggestion", "manual_search"];

export function isCardSightProvider(provider: string | null | undefined): boolean {
  return typeof provider === "string" && provider.toLowerCase().includes("cardsight");
}

/**
 * Where the user's confirmed card came from. A pick from a CardSight result (its top answer or one
 * of its candidates) is `cardsight_assisted`. A manual search counts as the user's own label only
 * when the chosen card wasn't one CardSight showed.
 */
export function classifyTrainingLabelSource(input: {
  via?: string | null;
  recognitionProvider?: string | null;
  chosenTcgdexId: string;
  shownTcgdexIds: readonly string[];
}): TrainingLabelSource {
  const manual = input.via === "manual_search";
  if (isCardSightProvider(input.recognitionProvider)) {
    // If CardSight was involved and the chosen card was shown, it's CardSight-assisted
    return manual && !input.shownTcgdexIds.includes(input.chosenTcgdexId) ? "manual_search" : "cardsight_assisted";
  }
  return manual ? "manual_search" : "in_house_suggestion";
}

export function trainingRetentionDaysFromEnv(env: Record<string, string | undefined> = {}): number {
  const raw = env.CARD_FLOW_TRAINING_RETENTION_DAYS?.trim();
  if (!raw) return TRAINING_RETENTION_DAYS_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : TRAINING_RETENTION_DAYS_DEFAULT;
}

/** True when a sample captured at `capturedAt` is past the retention limit. */
export function isTrainingSampleExpired(capturedAt: string, now: Date, days: number): boolean {
  const at = Date.parse(capturedAt);
  if (!Number.isFinite(at)) return true;
  const limit = new Date(at);
  limit.setUTCDate(limit.getUTCDate() + Math.floor(days));
  return now.getTime() >= limit.getTime();
}

/** Terms section, privacy page and Settings copy. */
export const TRAINING_PHOTO_LINE =
  `When you confirm a card in Scan a Card, PokeSniper may keep that photo and the card you confirmed to improve PokeSniper's own card recognition. These photos are stored securely with restricted access, and are deleted after ${TRAINING_RETENTION_DAYS_DEFAULT} days or when you delete your account. You can opt out anytime in Settings > Card recognition > Help improve card recognition; opting out stops new photos from being kept and deletes the ones already kept.`;

export const TRAINING_CAPTURE_COPY = {
  settingsLabel: "Help improve card recognition",
  settingsHelp:
    `When on, photos of cards you confirm in Scan a Card may be kept to improve PokeSniper's own card recognition. They're stored securely with restricted access, and are deleted after ${TRAINING_RETENTION_DAYS_DEFAULT} days or when you delete your account. Live Scan video and grade photos are never kept for this.`,
  optedOut: "Off. New photos won't be kept, and photos already kept for this were deleted.",
  optedIn: "On. Photos of cards you confirm may be kept to improve card recognition.",
} as const;

export interface TrainingPreferenceState {
  /** User setting (default on per the Terms). */
  enabled: boolean;
  /** Whether the server is capturing at all right now (off in production until explicitly enabled). */
  captureActive: boolean;
}
