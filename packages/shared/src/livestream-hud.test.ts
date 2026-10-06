import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LIVESTREAM_HUD_ID,
  LIVESTREAM_HUD_IDENTITY_EVENT,
  LIVESTREAM_HUD_SCANNER_EVENT,
  defaultLivestreamHudOrigin,
  livestreamHudOriginWhitelist,
  livestreamHudEventPath,
  livestreamHudPagePath,
} from "./livestream-hud";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Livestream HUD (HUDS) + Cap-go in-app browser", () => {
  it("pins unmodified HUDS as the overlay service and does not vendor its source", () => {
    const rootPackage = JSON.parse(readRepoFile("package.json")) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    expect(rootPackage.dependencies?.huds).toBe("2.2.2");
    expect(rootPackage.scripts?.["huds:up"]).toContain("infra/huds/up.sh");
    expect(existsSync(path.join(repoRoot, "apps/huds"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "packages/huds"))).toBe(false);
    expect(readRepoFile("infra/huds/up.sh")).toContain("overlay:$hud_dir");
    expect(readRepoFile("infra/huds/up.sh")).toContain("CARD_FLOW_HUDS_ADDRESS:-0.0.0.0");
    expect(readRepoFile("infra/huds/up.sh")).not.toContain("CARD_FLOW_HUDS_ADDRESS:-127.0.0.1");
    expect(readRepoFile("infra/huds/up.sh")).not.toContain("src/huds-server");
    expect(livestreamHudPagePath()).toBe(`/${LIVESTREAM_HUD_ID}/`);
    expect(livestreamHudEventPath(LIVESTREAM_HUD_SCANNER_EVENT)).toBe(
      "/overlay/event/scanner",
    );
    expect(livestreamHudEventPath(LIVESTREAM_HUD_IDENTITY_EVENT)).toBe(
      "/overlay/event/identity",
    );
    expect(defaultLivestreamHudOrigin("ios")).toBe("http://127.0.0.1:9999");
    expect(defaultLivestreamHudOrigin("android")).toBe("http://10.0.2.2:9999");
    expect(livestreamHudOriginWhitelist("http://127.0.0.1:9999/overlay/")).toEqual([
      "http://127.0.0.1:9999",
    ]);
    expect(livestreamHudOriginWhitelist("not a url")).toEqual([]);
  });

  it("serves a CardFlow overlay HUD that starts scanner-off and has no marketplace scrape", () => {
    const html = readRepoFile("infra/huds/overlay/index.html");
    const js = readRepoFile("infra/huds/overlay/overlay.js");
    expect(html).toContain('<script src="huds"></script>');
    expect(html).toContain("Scanner off");
    expect(html).toContain("CardFlow overlay · not a market");
    expect(js).toContain('huds.bind("scanner"');
    expect(js).toContain('huds.bind("identity"');
    expect(js).toContain("Looking for a card…");
    expect(js).toContain("Live guess · not confirmed");
    expect(js).toContain('getElementById("grade")');
    expect(html).toContain("Estimate");
    expect(html).toContain("Max Buy");
    expect(html).toContain("Grade");
    expect(html).toContain("not a cert");
    expect(`${html}\n${js}`).not.toMatch(/whatnot|ebay|inject|scrape|screenshot/i);
  });

  it("uses the react-native-webview live page (no Capacitor) without page scripts or stills", () => {
    const mobilePackage = readRepoFile("apps/mobile/package.json");
    const browser = readRepoFile("apps/mobile/lib/in-app-browser.ts");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    expect(mobilePackage).not.toMatch(/capacitor|capgo/i);
    expect(browser).not.toMatch(/from "@capacitor|from "@capgo/);
    expect(browser).toContain("LIVESTREAM_INAPP_BROWSER");
    expect(browser).toContain('return "unavailable";');
    expect(browser).not.toContain("executeScript");
    expect(browser).not.toContain("screenshotOnHide");
    expect(scanTab).toContain("LivestreamBrowser");
    expect(scanTab).toContain("url={chrome.pageUrl}");
    expect(scanTab).not.toContain("injectedJavaScript");
  });
});
