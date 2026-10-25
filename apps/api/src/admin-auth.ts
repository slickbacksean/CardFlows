/**
 * Sean (Oct 25): Admin authentication helper. Reads ADMIN_USER_IDS and ADMIN_EMAILS
 * environment variables to gate admin-only endpoints. Compatible with PR #122.
 */

const ADMIN_USER_IDS = new Set(
  (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

export function isAdmin(userId: string, email?: string | null): boolean {
  if (ADMIN_USER_IDS.has(userId)) return true;
  if (email && ADMIN_EMAILS.has(email.toLowerCase())) return true;
  return false;
}

export function getAdminUserIds(): string[] {
  return [...ADMIN_USER_IDS];
}

export function getAdminEmails(): string[] {
  return [...ADMIN_EMAILS];
}
