/**
 * Cap-go InAppBrowser for the livestream tab.
 * Native iOS/Android via Capacitor. Expo Go / web fall back to react-native-webview.
 * Does not scrape the live page or capture a still of it.
 */
import { Capacitor } from "@capacitor/core";
import { InAppBrowser, ToolBarType } from "@capgo/capacitor-inappbrowser";
import { LIVE_HLS_REPORT_SCRIPT, LIVESTREAM_INAPP_BROWSER, liveHlsUrlFromWebMessage } from "@cardflow/shared";
import { Platform } from "react-native";
import { noteLiveHlsUrl } from "./live-identify";
import { isExpoGoRuntime } from "./runtime-host";

export const LIVESTREAM_BROWSER_PLUGIN = LIVESTREAM_INAPP_BROWSER;

export interface LivestreamBrowserFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

let openId: string | null = null;
let closeListenerAttached = false;
let hlsListenerAttached = false;

export function isCapgoLivestreamBrowserAvailable(): boolean {
  if (Platform.OS === "web") return false;
  // Expo Go has no Capgo native overlay; JS stubs still report the plugin.
  if (isExpoGoRuntime()) return false;
  try {
    if (
      typeof Capacitor.isNativePlatform === "function" &&
      !Capacitor.isNativePlatform()
    ) {
      return false;
    }
    return (
      Capacitor.isPluginAvailable("CapgoInAppBrowser") ||
      Capacitor.isPluginAvailable("InAppBrowser")
    );
  } catch {
    return false;
  }
}

async function ensureCloseListener(): Promise<void> {
  if (closeListenerAttached) return;
  closeListenerAttached = true;
  await InAppBrowser.addListener("closeEvent", () => {
    openId = null;
  });
}

async function ensureHlsListener(): Promise<void> {
  if (hlsListenerAttached) return;
  hlsListenerAttached = true;
  await InAppBrowser.addListener("messageFromWebview", (event) => {
    const url = liveHlsUrlFromWebMessage(event);
    if (url) noteLiveHlsUrl(url);
  });
}

export async function openLivestreamBrowser(input: {
  url: string;
  frame: LivestreamBrowserFrame;
}): Promise<"capgo" | "unavailable"> {
  if (!isCapgoLivestreamBrowserAvailable()) return "unavailable";
  const { width, height, x, y } = input.frame;
  if (width < 8 || height < 8) return "unavailable";
  try {
    await ensureCloseListener();
    await ensureHlsListener();
    if (openId) {
      await InAppBrowser.updateDimensions({
        id: openId,
        x,
        y,
        width,
        height,
      });
      await InAppBrowser.setUrl({ id: openId, url: input.url });
      await InAppBrowser.show({ id: openId });
      return "capgo";
    }
    const opened = await InAppBrowser.openWebView({
      url: input.url,
      x,
      y,
      width,
      height,
      toolbarType: ToolBarType.BLANK,
      allowScreenshotsFromWebPage: false,
      preShowScript: LIVE_HLS_REPORT_SCRIPT,
      preShowScriptInjectionTime: "documentStart",
    });
    openId = opened.id;
    return "capgo";
  } catch {
    openId = null;
    return "unavailable";
  }
}

export async function hideLivestreamBrowser(): Promise<void> {
  if (!openId || !isCapgoLivestreamBrowserAvailable()) return;
  try {
    await InAppBrowser.hide({ id: openId });
  } catch {
    openId = null;
  }
}

export async function goBackLivestreamBrowser(): Promise<boolean> {
  if (!openId || !isCapgoLivestreamBrowserAvailable()) return false;
  try {
    const plugin = InAppBrowser as typeof InAppBrowser & {
      goBack?: (opts: { id: string }) => Promise<void>;
    };
    if (!plugin.goBack) return false;
    await plugin.goBack({ id: openId });
    return true;
  } catch {
    return false;
  }
}

export async function goForwardLivestreamBrowser(): Promise<boolean> {
  if (!openId || !isCapgoLivestreamBrowserAvailable()) return false;
  try {
    const plugin = InAppBrowser as typeof InAppBrowser & {
      goForward?: (opts: { id: string }) => Promise<void>;
    };
    if (!plugin.goForward) return false;
    await plugin.goForward({ id: openId });
    return true;
  } catch {
    return false;
  }
}

export async function closeLivestreamBrowser(): Promise<void> {
  if (!isCapgoLivestreamBrowserAvailable()) {
    openId = null;
    return;
  }
  try {
    await InAppBrowser.close(openId ? { id: openId } : undefined);
  } catch {
    /* already closed */
  }
  openId = null;
}
