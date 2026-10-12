/**
 * Every user-facing pre-grade string, in one place. Standing decision
 * (2026-10-05): the title is "Pre-grade estimate", the disclaimer is
 * "Estimate only. Not an official grade.", the word "AI" is never shown, and
 * no grading company is named. Server responses and the app both read these;
 * a test greps this file and the app for regressions.
 */
export const PREGRADE_TITLE = "Pre-grade estimate" as const;
export const PREGRADE_DISCLAIMER_TEXT = "Estimate only. Not an official grade." as const;

export const PREGRADE_COPY = {
  title: PREGRADE_TITLE,
  disclaimer: PREGRADE_DISCLAIMER_TEXT,
  /** Result line prefix for the number, e.g. "Pre-grade 7.5". */
  displayPrefix: "Pre-grade",
  surfaceNotAssessed: "Surface not assessed from a single photo.",
  surfaceNotAssessedBack: "Back surface not assessed.",
  surfaceAngledFailed: "Surface not assessed. The extra light photos weren't clear enough.",
  surfaceAngledNoLight:
    "Surface not assessed. The extra photos didn't show the light from different sides.",
  surfaceExcludedNote: "Surface isn't part of this estimate.",
  surfaceIncludedNote: "Surface checked from your extra light photos.",
  sizeNotCheckedNote: "Card size isn't checked from photos.",
  // Retake reasons (no number is shown with these).
  blurry: "Photo is blurry",
  tooFar: "Card is too small in the photo. Move a little closer",
  tilted: "Hold the phone flat over the card",
  shapeOff: "Couldn't see the whole card",
  notFound: "Card not found",
  unreadable: "Couldn't read the photo",
  nothingMeasured: "Nothing could be measured in these photos",
  unusable: "Couldn't use this photo",
  sameSide: "The front and back photos look like the same side.",
  // Soft warnings (still scored).
  glare: "Glare on the card",
  unevenLight: "Uneven light",
  lowResolution: "Low photo resolution",
  smallInFrame: "Card is small in the photo",
} as const;

/** Words that must never reach a pre-grade screen or response. */
export const PREGRADE_BANNED_WORDS = [/\bAI\b/, /\bPSA\b/, /\bBGS\b/, /\bCGC\b/] as const;

export function pregradeCopyViolations(text: string): string[] {
  return PREGRADE_BANNED_WORDS.filter((word) => word.test(text)).map((word) => word.source);
}
