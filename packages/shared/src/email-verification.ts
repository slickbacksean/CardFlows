/**
 * Sean: email verification before pre-grade estimates. Accounts created by open sign-up get a
 * 6-digit code by email; invite-code testers and accounts from before verification shipped count
 * as verified.
 */
export const EMAIL_CODE_LENGTH = 6;
/** Codes work once and expire after 15 minutes. */
export const EMAIL_VERIFICATION_TTL_MS = 15 * 60 * 1000;
/** Wait this long before requesting another code (the app's resend button counts down). */
export const EMAIL_RESEND_COOLDOWN_MS = 60 * 1000;
/** Backend review M1: verification codes one account can ever be sent. */
export const EMAIL_CODE_LIFETIME_SENDS = 10;
/** Backend review M1: emails (verification + reset) one address can get per UTC day. */
export const EMAIL_SENDS_PER_ADDRESS_PER_DAY = 10;
/** Accounts that never verify are deleted after this many days. */
export const UNVERIFIED_ACCOUNT_TTL_DAYS = 7;
/** 403 `error` on pre-grade estimate routes until the email is verified. */
export const EMAIL_UNVERIFIED_CODE = "email_unverified" as const;

export const EMAIL_VERIFICATION_COPY = {
  required: "Verify your email to get pre-grade estimates. Enter the 6-digit code we emailed you.",
  sent: "We sent a 6-digit code to your email. It works once and expires in 15 minutes.",
  invalid: "That code is invalid or has expired. Request a new one.",
  tooSoon: "Wait a minute before requesting another code.",
  sendLimit: "You've reached the limit for verification codes. Contact support to verify your email.",
  dailyLimit: "Too many emails to this address today. Try again tomorrow.",
  verified: "Email verified. You can now get pre-grade estimates.",
  /** UX review P1-8 (without "AI": estimate copy never says AI). */
  fromPregrade: "Almost there. Verify your email to see your pre-grade estimate.",
  promptTitle: "Verify your email first",
  promptBody: "Pre-grade estimates need a verified email.",
  emailSubject: "Your CardFlow verification code",
  resetSubject: "Your CardFlow password reset code",
} as const;

/** UX review P1-8: what verifying unlocks, and where the code went. */
export function verifyEmailIntro(email?: string | null): string {
  const to = email && email.trim() ? email.trim() : "your email";
  return `Verify your email to get pre-grade estimates. We sent a 6-digit code to ${to}.`;
}

export function isEmailCode(value: string): boolean {
  return new RegExp(`^\\d{${EMAIL_CODE_LENGTH}}$`).test(value.trim());
}

export function verificationEmailText(code: string): string {
  return `Your CardFlow verification code is ${code}. It works once and expires in 15 minutes. If you didn't sign up for CardFlow, ignore this email.`;
}

export function passwordResetEmailText(code: string): string {
  return `Your CardFlow password reset code is:\n\n${code}\n\nIt works once and expires in 1 hour. If you didn't ask to reset your password, ignore this email.`;
}
