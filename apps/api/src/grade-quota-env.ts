import { CARDSIGHT_MONTHLY_BUDGET_DEFAULT } from "@cardflow/shared";

type Env = NodeJS.Dict<string | undefined>;

function isTestEnv(env: Env): boolean {
  return env.VITEST === "true" || env.NODE_ENV === "test";
}

function flag(raw: string | undefined): boolean | null {
  const value = raw?.trim().toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return null;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw?.trim() ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Per-account monthly quota. Off in tests unless CARD_FLOW_GRADE_QUOTA is set. */
export function gradeQuotaEnabledFromEnv(env: Env = process.env): boolean {
  const explicit = flag(env.CARD_FLOW_GRADE_QUOTA);
  if (explicit === false) return false;
  if (isTestEnv(env) && explicit == null) return false;
  return true;
}

/**
 * Real StoreKit / Play Billing is not wired (no Apple Developer account yet).
 * `CARD_FLOW_IAP_STUB=true` lets local/dev grant credits without a receipt.
 */
export function gradeIapFromEnv(env: Env = process.env): { enabled: boolean; stub: boolean } {
  return {
    enabled: flag(env.CARD_FLOW_IAP_ENABLED) === true,
    stub: flag(env.CARD_FLOW_IAP_STUB) === true,
  };
}

export function premiumUserIdsFromEnv(env: Env = process.env): string[] {
  const raw = env.CARD_FLOW_PREMIUM_USER_IDS ?? "";
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Global CardSight identify budget. Null in tests unless configured. */
export function cardSightMonthlyBudgetFromEnv(env: Env = process.env): number | null {
  if (env.CARD_FLOW_CARDSIGHT_BUDGET?.trim().toLowerCase() === "false") return null;
  if (isTestEnv(env) && !env.CARD_FLOW_CARDSIGHT_MONTHLY_BUDGET) return null;
  return positiveInt(env.CARD_FLOW_CARDSIGHT_MONTHLY_BUDGET, CARDSIGHT_MONTHLY_BUDGET_DEFAULT);
}

/** Backend review M5: default per-user CardSight calls per calendar month. */
export const CARDSIGHT_USER_MONTHLY_CAP_DEFAULT = 50;
export const CARDSIGHT_GUEST_MONTHLY_CAP_DEFAULT = 3;

function capFromEnv(raw: string | undefined, fallback: number): number {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return fallback;
  return Number(value);
}

/**
 * Backend review M5: CARD_FLOW_CARDSIGHT_USER_MONTHLY_CAP (default 50) and
 * CARD_FLOW_CARDSIGHT_GUEST_MONTHLY_CAP (default 3). 0 = that group never uses CardSight.
 */
export function cardSightUserCapsFromEnv(env: Env = process.env): { signedIn: number; guest: number } {
  return {
    signedIn: capFromEnv(env.CARD_FLOW_CARDSIGHT_USER_MONTHLY_CAP, CARDSIGHT_USER_MONTHLY_CAP_DEFAULT),
    guest: capFromEnv(env.CARD_FLOW_CARDSIGHT_GUEST_MONTHLY_CAP, CARDSIGHT_GUEST_MONTHLY_CAP_DEFAULT),
  };
}
