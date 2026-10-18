import { GUEST_SIGNUP_COPY } from "@cardflow/shared";
import { router } from "expo-router";
import { useEffect } from "react";
import { Alert } from "react-native";
import { isGuestSession } from "./identity";

/**
 * Sean (Oct 17, 8:36 PM PT): guests are browse-only. One sign-up prompt, the same one the API's
 * 403 signup_required opens: "Sign up to scan, grade and save cards. It's free."
 */
let showing = false;

export function showSignupPrompt(): void {
  if (showing) return;
  showing = true;
  const done = () => {
    showing = false;
  };
  Alert.alert(
    GUEST_SIGNUP_COPY.title,
    GUEST_SIGNUP_COPY.body,
    [
      { text: GUEST_SIGNUP_COPY.dismiss, style: "cancel", onPress: done },
      {
        text: GUEST_SIGNUP_COPY.action,
        onPress: () => {
          done();
          router.push("/sign-up");
        },
      },
    ],
    { cancelable: true, onDismiss: done },
  );
}

/**
 * Before a scan, grade or save: true for an account. A guest gets the sign-up prompt instead and
 * nothing starts (no camera, no upload).
 */
export function requireAccount(): boolean {
  if (!isGuestSession()) return true;
  showSignupPrompt();
  return false;
}

/** A screen that is itself a gated action (the camera): a guest gets the prompt and is sent back. */
export function useAccountOrLeave(): void {
  useEffect(() => {
    if (requireAccount()) return;
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/collection");
  }, []);
}
