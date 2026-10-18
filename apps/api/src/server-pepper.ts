/**
 * Backend review L3 (P4): server-side secret mixed into hashes of personal data that must stay
 * lookup-able (email_send_counts keys), so a leaked database can't be reversed by hashing a list
 * of known emails. Production refuses to start without CARD_FLOW_SERVER_PEPPER (see
 * production-config.ts). Dev and tests use a fixed dev-only value.
 */
export const SERVER_PEPPER_ENV = "CARD_FLOW_SERVER_PEPPER";
export const SERVER_PEPPER_MIN_LENGTH = 32;
const DEV_ONLY_SERVER_PEPPER = "cardflow-dev-only-server-pepper-not-for-production";

type Env = NodeJS.Dict<string | undefined>;

export function serverPepperProblem(env: Env): string | null {
  if (env.NODE_ENV !== "production") return null;
  const value = env[SERVER_PEPPER_ENV]?.trim() ?? "";
  if (value.length >= SERVER_PEPPER_MIN_LENGTH) return null;
  return `${SERVER_PEPPER_ENV} must be set to a random secret of at least ${SERVER_PEPPER_MIN_LENGTH} characters.`;
}

/** Throws in production when the pepper is missing or short (fail closed). */
export function serverPepper(env: Env = process.env): string {
  const problem = serverPepperProblem(env);
  if (problem) throw new Error(problem);
  const value = env[SERVER_PEPPER_ENV]?.trim();
  return value && value.length >= SERVER_PEPPER_MIN_LENGTH ? value : DEV_ONLY_SERVER_PEPPER;
}
