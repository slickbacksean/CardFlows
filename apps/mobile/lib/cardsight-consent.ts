import { CARDSIGHT_CONSENT_COPY, CARDSIGHT_CONSENT_VERSION, type CardSightConsentState } from "@cardflow/shared";
import { Alert } from "react-native";
import { getCardSightConsent, setCardSightConsent } from "./api";

let answered = false;
let asking: Promise<void> | null = null;

/**
 * Sean: one-time CardSight disclosure before the first photo is uploaded. Allow or decline is
 * stored on the server (with its version); the server enforces it, so an offline or failed
 * check never sends a photo to CardSight. It just uses PokeSniper's own matcher.
 */
export async function askCardSightConsentOnce(): Promise<void> {
  if (answered) return;
  if (asking) return asking;
  asking = (async () => {
    let state: CardSightConsentState;
    try {
      state = (await getCardSightConsent()).consent;
    } catch {
      return; // Unknown: the server treats it as no consent.
    }
    if (!state.needsPrompt) {
      answered = true;
      return;
    }
    await new Promise<void>((resolve) => {
      const answer = (granted: boolean) => {
        void saveCardSightConsent(granted).finally(resolve);
      };
      Alert.alert(
        CARDSIGHT_CONSENT_COPY.title,
        CARDSIGHT_CONSENT_COPY.body,
        [
          { text: CARDSIGHT_CONSENT_COPY.decline, style: "cancel", onPress: () => answer(false) },
          { text: CARDSIGHT_CONSENT_COPY.allow, onPress: () => answer(true) },
        ],
        { cancelable: false },
      );
    });
  })().finally(() => {
    asking = null;
  });
  return asking;
}

/** A different user (sign-up, sign-in, invite) gets asked unless the server already has their answer. */
export function resetCardSightConsentCache(): void {
  answered = false;
}

/** Settings toggle and the prompt. Returns the server's state (null if it couldn't be saved). */
export async function saveCardSightConsent(granted: boolean): Promise<CardSightConsentState | null> {
  try {
    const res = await setCardSightConsent(granted, CARDSIGHT_CONSENT_VERSION);
    answered = true;
    return res.consent;
  } catch {
    return null;
  }
}
