import { GUEST_RETENTION_NOTE, GUEST_SCAN_WALL_NOTE } from "@cardflow/shared";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Alert } from "react-native";
import { isGuestSession } from "./identity";

const SEEN_KEY = "cardflow.guestNoticeSeen";
let seen: boolean | null = null;

/**
 * Before a guest's first scan: say scans are deleted within 24 h unless they sign up, and that
 * the guest limit counts scans (not pre-grade estimates). Resolves true to go ahead with the scan.
 */
export async function confirmGuestNoticeOnce(): Promise<boolean> {
  if (!isGuestSession()) return true;
  if (seen === null) seen = (await SecureStore.getItemAsync(SEEN_KEY).catch(() => null)) === "1";
  if (seen) return true;
  return new Promise((resolve) => {
    const done = (go: boolean) => {
      seen = true;
      void SecureStore.setItemAsync(SEEN_KEY, "1").catch(() => undefined);
      resolve(go);
    };
    Alert.alert("Scanning as a guest", `${GUEST_SCAN_WALL_NOTE}\n\n${GUEST_RETENTION_NOTE}`, [
      { text: "Sign up", onPress: () => { done(false); router.push("/sign-up"); } },
      { text: "Continue", style: "default", onPress: () => done(true) },
    ], { cancelable: false });
  });
}
