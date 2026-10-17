/** Open sign-up (email + password). Rules shared by the API and the app. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 254;

export const ACCOUNT_AUTH_COPY = {
  signInFailed: "Email or password is incorrect.",
  signUpFailed: "We couldn't create an account with those details. If you already have one, sign in instead.",
  badEmail: "Enter a valid email address.",
  badPassword: `Use at least ${PASSWORD_MIN_LENGTH} characters for your password.`,
  tooMany: "Too many attempts. Try again later.",
} as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length > 0 && trimmed.length <= EMAIL_MAX_LENGTH && EMAIL.test(trimmed);
}

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return ACCOUNT_AUTH_COPY.badPassword;
  if (/^(.)\1*$/.test(password)) return ACCOUNT_AUTH_COPY.badPassword;
  return null;
}
