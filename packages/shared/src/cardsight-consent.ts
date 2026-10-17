/**
 * Sean: CardSight disclosure + consent. Before any photo goes to CardSight (our card-recognition
 * provider), the app asks once. Without consent the server uses CardFlow's own matcher only (or
 * manual search). Bump the version when the wording or CardSight's terms change: everyone is
 * asked again, and older consents stop counting.
 */
export const CARDSIGHT_PROVIDER_NAME = "CardSight";
export const CARDSIGHT_CONSENT_VERSION = "2026-10-17";

export const CARDSIGHT_CONSENT_COPY = {
  title: "Card recognition",
  body:
    "CardFlow uses CardSight, our card-recognition provider, to identify cards from your photos. " +
    "If you allow it, your card photos are uploaded to CardFlow and CardSight. CardSight's terms allow it " +
    "to use these images to improve its service. If you don't allow it, CardFlow matches cards on its own " +
    "servers only, or you can search manually. You can change this anytime in Settings.",
  allow: "Allow CardSight",
  decline: "Don't allow",
  settingsLabel: "Use CardSight for card recognition",
  settingsHelp:
    "When on, card photos are uploaded to CardFlow and CardSight, our card-recognition provider. " +
    "CardSight's terms allow it to use these images to improve its service. When off, CardFlow matches cards on its own servers only.",
  withdrawn: "CardSight is off. New photos are matched by CardFlow only.",
} as const;

export interface CardSightConsentState {
  granted: boolean;
  /** Version the user last answered (null if never asked). */
  version: string | null;
  grantedAt: string | null;
  withdrawnAt: string | null;
  currentVersion: string;
  /** True when the app should show the one-time prompt (never answered, or an older version). */
  needsPrompt: boolean;
}
