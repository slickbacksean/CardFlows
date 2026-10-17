/**
 * Sean (Oct 16, 2026): CardFlow is for adults 18 and older (CardSight's terms forbid photos from
 * anyone under 18). Policy Reviewer: the app asks for birth month and year (pickers start empty,
 * nothing pre-checked), checks the age on the device, then throws the birth date away. The
 * server stores only `age_confirmed_18plus`, a timestamp and the gate version. Under 18: no
 * upload, no sign-up, nothing sent to the server, CardSight or analytics, and a device-side
 * lockout. Order before the first upload: age gate, then the CardSight prompt.
 */

/** Bump when the gate's wording or rule changes; everyone is asked again. */
export const AGE_GATE_VERSION = "2026-10-17.1";
export const AGE_MINIMUM = 18;
export const AGE_CONFIRMATION_REQUIRED_CODE = "age_confirmation_required";

/** Policy Reviewer: exact copy. */
export const AGE_GATE_COPY = {
  title: "How old are you?",
  body: "CardFlow is for adults 18 and older. Enter your birth month and year.",
  button: "Continue",
  underAge: "Sorry, CardFlow is only available to people 18 and older.",
  signUpLine: "By creating an account, you confirm you're 18 or older and agree to the Terms and Privacy Policy.",
  captureTip: "Photograph only the card. Keep faces, hands, and personal details out of the shot.",
  monthLabel: "Birth month",
  yearLabel: "Birth year",
  monthPlaceholder: "Month",
  yearPlaceholder: "Year",
  /** Server answer when an upload, scan or sign-up arrives without a confirmation. */
  required: "Confirm your age to continue.",
} as const;

export const AGE_GATE_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Years offered by the year picker, newest first (current year back 100 years). */
export function ageGateYears(now: Date = new Date()): number[] {
  const current = now.getFullYear();
  return Array.from({ length: 101 }, (_, i) => current - i);
}

export type AgeCheck = "adult" | "under_18" | "invalid";

/**
 * Month + year only, so the exact birthday is unknown. In the birth month of the 18th year the
 * person is treated as 18 (otherwise the lockout would shut out people who turn 18 that month).
 * `birthMonth` is 1-12. Nothing here is stored or sent.
 */
export function checkAge(birthMonth: number | null, birthYear: number | null, now: Date = new Date()): AgeCheck {
  if (birthMonth == null || birthYear == null) return "invalid";
  if (!Number.isInteger(birthMonth) || birthMonth < 1 || birthMonth > 12) return "invalid";
  if (!Number.isInteger(birthYear) || birthYear < now.getFullYear() - 120) return "invalid";
  const months = (now.getFullYear() - birthYear) * 12 + (now.getMonth() + 1 - birthMonth);
  if (months < 0) return "invalid";
  return months >= AGE_MINIMUM * 12 ? "adult" : "under_18";
}

export interface AgeConfirmationState {
  confirmed: boolean;
  /** Gate version the user confirmed (null if never). */
  version: string | null;
  confirmedAt: string | null;
  currentVersion: string;
}
