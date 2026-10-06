import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const SCREENSHOT_APIS =
  /view-shot|captureScreen|capturePage|takeSnapshot|toDataURL|captureRef|ViewShot/i;

describe("Livestream in-house browser + scanner control", () => {
  it("loads Whatnot and eBay live pages in-app without scraping or bid injection", () => {
    const livestream = readRepoFile("apps/mobile/lib/livestream.ts");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const browser = readRepoFile("apps/mobile/lib/in-app-browser.ts");
    const browserView = readRepoFile("apps/mobile/components/ui/livestream-browser.tsx");
    const mobilePackage = readRepoFile("apps/mobile/package.json");

    expect(mobilePackage).not.toMatch(/capacitor|capgo/i);
    expect(mobilePackage).toContain("react-native-webview");
    expect(scanTab).toContain("LivestreamBrowser");
    expect(scanTab).toContain("url={chrome.pageUrl}");
    expect(scanTab).toContain("hudLayer");
    expect(scanTab).toContain('position: "absolute"');
    expect(browserView).toContain('from "react-native-webview"');
    expect(browser).toContain("isCapgoLivestreamBrowserAvailable(): boolean {\n  return false;");
    expect(livestream).toContain('pageUrl: "https://www.whatnot.com"');
    expect(livestream).toContain('pageUrl: "https://www.ebay.com/ebaylive"');
    expect(scanTab).not.toContain("injectedJavaScript");
    expect(scanTab).not.toContain("injectJavaScript");
    expect(scanTab).not.toContain("onMessage");
    expect(scanTab).not.toContain("onShouldStartLoadWithRequest");
    expect(scanTab).not.toMatch(/bid|placeBid|intercept/i);
    expect(scanTab).not.toContain("openBrowserAsync");
    expect(scanTab).not.toContain("Linking.openURL");
    expect(browser).not.toContain("executeScript");
    expect(browserView).toContain("injectedJavaScriptBeforeContentLoaded={LIVE_HLS_REPORT_SCRIPT}");
  });

  it("keeps the scanner off until toggled and stops it on blur or tester switch", () => {
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const identity = readRepoFile("apps/mobile/lib/identity.ts");
    const liveIdentify = readRepoFile("apps/mobile/lib/live-identify.ts");

    expect(scanTab).toContain("useState(false)");
    expect(scanTab).toContain("startLiveVideoIdentify()");
    expect(scanTab).toContain("stopLiveVideoIdentify()");
    expect(scanTab).toContain("accessibilityLabel=\"Scanner\"");
    expect(scanTab).toContain("accessibilityRole=\"switch\"");
    expect(scanTab).toContain("Starts live-video identify without taking a screenshot");
    expect(scanTab).toContain("useFocusEffect");
    const blurCleanup = scanTab.slice(scanTab.indexOf("return () => {"));
    expect(blurCleanup).toContain("setTabFocused(false)");
    expect(blurCleanup).toContain("stopLiveVideoIdentify()");
    expect(blurCleanup).toContain("setScannerOn(false)");
    expect(identity).toContain("stopLiveVideoIdentify()");
    expect(liveIdentify).toContain("export function startLiveVideoIdentify");
    expect(liveIdentify).toContain("export function stopLiveVideoIdentify");
    expect(liveIdentify).not.toMatch(SCREENSHOT_APIS);
    expect(liveIdentify).not.toContain("/v1/scans");
    expect(liveIdentify).not.toContain("tcgdex_id");
  });

  it("does not take a screenshot or send the tester to Capture from this tab", () => {
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const overlay = readRepoFile("apps/mobile/components/ui/screener-overlay.tsx");
    const collection = readRepoFile("apps/mobile/app/(tabs)/collection.tsx");
    const liveIdentify = readRepoFile("apps/mobile/lib/live-identify.ts");

    expect(scanTab).not.toMatch(SCREENSHOT_APIS);
    expect(scanTab).not.toContain("/capture");
    expect(scanTab).not.toContain("createScan");
    expect(scanTab).not.toContain("/v1/scans");
    expect(scanTab).not.toMatch(/Scan a still photo|Overlay is not live ID/);
    expect(overlay).not.toContain("onScanStill");
    expect(overlay).not.toMatch(/Scan a still photo|Overlay is not live ID/);
    expect(overlay).toContain("Scanner off");
    expect(overlay).toContain("Looking for a card…");
    expect(overlay).toContain("HudEmptyFigures");
    expect(overlay).toContain("not a cert");
    expect(collection).toContain('router.push("/capture")');
    expect(liveIdentify).toContain("Do not snapshot the live page");
  });
});
