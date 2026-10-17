/**
 * Sean: CardSight disclosure + consent. Before any photo goes to CardSight (our card-recognition
 * provider), the app asks once. Without consent the server uses CardFlow's own matcher only (or
 * manual search). Bump the version when the wording or CardSight's terms change: everyone is
 * asked again, and older consents stop counting.
 */
export const CARDSIGHT_PROVIDER_NAME = "CardSight";
/** Policy Reviewer (Oct 16): new wording (keeps images, trains AI models), so everyone is asked again. */
export const CARDSIGHT_CONSENT_VERSION = "2026-10-17.2";

/**
 * The only CardFlow copy allowed to say "AI": CardSight's own terms, disclosed word for word.
 * Estimate copy never mentions AI (tests scan all app copy and exempt only these two strings).
 */
const CARDSIGHT_DISCLOSURE_BODY =
  "CardFlow can use CardSight, our card-recognition provider, to identify cards from your photos. If you allow it, your card photos are sent to CardSight. CardSight's terms let it keep these images and use them to train its AI models. Turning this off later stops new uploads but doesn't remove photos CardSight already has. If you don't allow it, CardFlow matches cards on its own servers, or you can search manually. You can change this anytime in Settings.";
const CARDSIGHT_DISCLOSURE_SETTINGS_HELP =
  "When on, card photos are also sent to CardSight, our card-recognition provider. CardSight's terms let it keep these images and use them to train its AI models. Turning this off stops new uploads but doesn't remove photos CardSight already has. When off, CardFlow matches cards on its own servers only.";

export const CARDSIGHT_AI_DISCLOSURES: readonly string[] = [CARDSIGHT_DISCLOSURE_BODY, CARDSIGHT_DISCLOSURE_SETTINGS_HELP];

export const CARDSIGHT_CONSENT_COPY = {
  title: "Card recognition",
  body: CARDSIGHT_DISCLOSURE_BODY,
  allow: "Allow CardSight",
  decline: "Don't allow",
  settingsLabel: "Use CardSight for card recognition",
  settingsHelp: CARDSIGHT_DISCLOSURE_SETTINGS_HELP,
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
