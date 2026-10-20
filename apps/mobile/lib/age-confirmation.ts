import { AGE_GATE_COPY, type AgeConfirmationState } from "@cardflow/shared";
import { Alert } from "react-native";
import { confirmAgeOnServer, getAgeConfirmation } from "./api";

let confirmed = false;
let asking: Promise<boolean> | null = null;

/**
 * Policy Reviewer (Oct 17): CardSight is only for accounts that attested 18+. New accounts did
 * at sign-up; testers and existing accounts confirm once here, before the CardSight prompt.
 * "Not now" (or any failure) just means PokeSniper's own matcher. Never shown to guests.
 */
export async function ensureAccountAgeConfirmed(): Promise<boolean> {
  if (confirmed) return true;
  if (asking) return asking;
  asking = (async () => {
    let state: AgeConfirmationState;
    try {
      state = (await getAgeConfirmation()).age;
    } catch {
      return false;
    }
    if (state.confirmed) {
      confirmed = true;
      return true;
    }
    const yes = await new Promise<boolean>((resolve) => {
      Alert.alert(
        AGE_GATE_COPY.confirmTitle,
        AGE_GATE_COPY.confirmBody,
        [
          { text: AGE_GATE_COPY.confirmLater, style: "cancel", onPress: () => resolve(false) },
          { text: AGE_GATE_COPY.confirmAction, onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
    if (!yes) return false;
    try {
      confirmed = (await confirmAgeOnServer()).age.confirmed;
    } catch {
      confirmed = false;
    }
    return confirmed;
  })().finally(() => {
    asking = null;
  });
  return asking;
}

/** A different account (sign-in, sign-up, invite) is checked again. */
export function resetAgeConfirmationCache(): void {
  confirmed = false;
}
