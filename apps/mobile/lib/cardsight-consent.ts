import { CARDSIGHT_CONSENT_VERSION, type CardSightConsentState } from "@cardflow/shared";
import { setCardSightConsent } from "./api";

/**
 * Sean (Oct 21): CardSight consent is part of the Terms of Service accepted at sign-up, so the
 * app never shows a separate CardSight prompt. Settings > Card recognition can still turn it off
 * (or back on); the server enforces it before any call.
 */

/** Kept for sign-in/sign-out call sites; there is no per-user prompt cache any more. */
export function resetCardSightConsentCache(): void {}

/** Settings toggle. Returns the server's state (null if it couldn't be saved). */
export async function saveCardSightConsent(granted: boolean): Promise<CardSightConsentState | null> {
  try {
    const res = await setCardSightConsent(granted, CARDSIGHT_CONSENT_VERSION);
    return res.consent;
  } catch {
    return null;
  }
}
