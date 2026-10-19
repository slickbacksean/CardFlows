/**
 * Sean (Oct 17, 2026): CardFlow accounts are for adults 18 and older, stated at sign-up. There
 * is no birth-date screen. Sign-up has a required checkbox (unchecked by default), "I confirm
 * I'm 18 or older.", plus the Terms/Privacy line. The API refuses `POST /v1/accounts` without
 * `ageConfirmed18Plus: true` and stores only `age_attested_at` and this wording version.
 * Testers and existing accounts confirm once in the app (`POST /v1/age-confirmation`) before any
 * CardSight call. Guest look-around is removed (Sean, Oct 18): every user is an account or
 * invite tester.
 */

/** Version of the sign-up statement. Bump when its wording changes. */
export const AGE_GATE_VERSION = "2026-10-17.2";
export const AGE_MINIMUM = 18;
export const AGE_CONFIRMATION_REQUIRED_CODE = "age_confirmation_required";

/** Policy Reviewer: exact copy. */
export const AGE_GATE_COPY = {
  /** Sign-up checkbox, unchecked by default and required. */
  checkbox: "I confirm I'm 18 or older.",
  /** Testers and existing accounts confirm once in the app before any CardSight call. */
  confirmTitle: "Confirm your age",
  confirmBody: "CardSight card recognition is for people 18 and older. Until you confirm, CardFlow's own matcher identifies your cards.",
  confirmAction: "I confirm I'm 18 or older.",
  confirmLater: "Not now",
  /** Retained for docs/tests of the retired guest path; the app no longer shows guest Settings. */
  guestSettings: "Create a free account to use CardSight card recognition.",
  signUpLine: "By creating an account, you confirm you're 18 or older and agree to the Terms and Privacy Policy.",
  captureTip: "Photograph only the card. Keep faces, hands, and personal details out of the shot.",
  /** API answer when sign-up arrives without the checkbox. */
  required: "Confirm you're 18 or older to create an account.",
  /** UX review P1-7: why Create account is disabled, under the unchecked box. */
  disabledCaption: "You must be 18 or older to create an account.",
  disabledHint: "Confirm you're 18 or older to continue.",
} as const;

export interface AgeConfirmationState {
  confirmed: boolean;
  /** Wording version the account attested to (null if never). */
  version: string | null;
  attestedAt: string | null;
  currentVersion: string;
}
