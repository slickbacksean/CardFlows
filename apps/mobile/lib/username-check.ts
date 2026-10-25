/**
 * Username check and redirect helper for post-auth flow.
 * Call after successful sign-in/sign-up to route to username setup if needed.
 */

import { router } from "expo-router";
import { getUsername } from "./api";

let usernameCheckPrompted = false; // Prevent multiple prompts in same session

export async function checkAndPromptUsername(): Promise<boolean> {
  if (usernameCheckPrompted) return true;

  try {
    const result = await getUsername();
    
    if ("error" in result) {
      // API error, proceed to app
      return true;
    }

    if (!result.username) {
      // No username set, redirect to setup
      usernameCheckPrompted = true;
      router.replace("/username-setup");
      return false;
    }

    // Has username, proceed
    return true;
  } catch {
    // Error checking, proceed to app
    return true;
  }
}

export function resetUsernameCheck() {
  usernameCheckPrompted = false;
}
