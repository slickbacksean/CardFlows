/**
 * Native in-app browser overlay for the livestream tab: not available.
 *
 * This used to wrap the Capgo (Capacitor) InAppBrowser plugin, but this is a React
 * Native app with no Capacitor shell, so the plugin was never linked natively and
 * always reported unavailable. The Capacitor packages were removed; the livestream
 * tab uses react-native-webview (components/ui/livestream-browser.tsx).
 * Does not scrape the live page or capture a still of it.
 */
import { LIVESTREAM_INAPP_BROWSER } from "@cardflow/shared";

export const LIVESTREAM_BROWSER_PLUGIN = LIVESTREAM_INAPP_BROWSER;

export interface LivestreamBrowserFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Always false: the webview fallback is the livestream browser. */
export function isCapgoLivestreamBrowserAvailable(): boolean {
  return false;
}

export async function openLivestreamBrowser(_input: {
  url: string;
  frame: LivestreamBrowserFrame;
}): Promise<"capgo" | "unavailable"> {
  return "unavailable";
}

export async function hideLivestreamBrowser(): Promise<void> {}

export async function goBackLivestreamBrowser(): Promise<boolean> {
  return false;
}

export async function goForwardLivestreamBrowser(): Promise<boolean> {
  return false;
}

export async function closeLivestreamBrowser(): Promise<void> {}
