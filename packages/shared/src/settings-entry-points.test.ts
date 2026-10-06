import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function stackScreen(source: string, name: string): string {
  const start = source.indexOf(`name="${name}"`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf("<Stack.Screen", start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

const CRM_WRITE_PATTERN =
  /createScan|confirmScan|savePurchased|saveWatchlist|createDraft|patchDraft|markDraftReady/;

describe("Settings entry points", () => {
  it("opens Settings from the avatar, then Max Buy rules and About", () => {
    const header = readRepoFile("apps/mobile/components/ui/app-header.tsx");
    const settings = readRepoFile("apps/mobile/app/settings.tsx");

    expect(header).toContain('accessibilityLabel="Open Settings"');
    expect(header).toContain('router.push("/settings")');
    expect(settings).toContain('label={settingsJobLabel("max_buy_rules")}');
    expect(settings).toContain('router.push("/max-buy-rules")');
    expect(settings).toContain('label={settingsJobLabel("about")}');
    expect(settings).toContain('router.push("/about")');
  });

  it("still opens Max Buy rules from Detail", () => {
    const decide = readRepoFile("apps/mobile/app/decide/[cardflowCardId].tsx");
    expect(decide).toContain('label="Edit Max Buy rules"');
    expect(decide).toContain('router.push("/max-buy-rules")');
  });

  it("hides the tab bar on Settings, About, and Max Buy stack screens", () => {
    const root = readRepoFile("apps/mobile/app/_layout.tsx");
    const tabs = readRepoFile("apps/mobile/app/(tabs)/_layout.tsx");

    expect(stackScreen(root, "settings")).toContain("headerShown: false");
    expect(stackScreen(root, "about")).toContain("headerShown: false");
    expect(stackScreen(root, "max-buy-rules")).toContain("headerShown: false");

    expect(tabs).toContain('name="collection"');
    expect(tabs).toContain('name="shop"');
    expect(tabs).toContain('name="scan-tab"');
    expect(tabs).toContain('title: "Livestream Screener"');
    expect(tabs).toContain('name="grading"');
    expect(tabs).toContain('name="export"');
    expect(tabs).not.toMatch(/name="settings"/);
    expect(tabs).not.toMatch(/tabBarLabel: "Settings"/);
    expect(tabs).not.toMatch(/name="about"/);
    expect(tabs).not.toMatch(/name="max-buy-rules"/);
  });

  it("keeps Livestream as the center tab", () => {
    const tabs = readRepoFile("apps/mobile/app/(tabs)/_layout.tsx");
    const tabBar = readRepoFile("apps/mobile/components/ui/app-tab-bar.tsx");
    const center = readRepoFile("apps/mobile/components/ui/scan-tab-button.tsx");

    expect(tabs).toContain('tabBarLabel: "Livestream Screener"');
    expect(tabBar).toContain('scanRoute = state.routes.find((route) => route.name === "scan-tab")');
    expect(center).toContain('accessibilityLabel="Livestream Screener"');
    expect(center).toContain("Livestream");
    expect(center).not.toMatch(/Settings/);
  });

  it("dismisses Settings, About, and Max Buy with Close or Back and no extra CRM writes", () => {
    const header = readRepoFile("apps/mobile/components/ui/preferences-screen-header.tsx");
    const settings = readRepoFile("apps/mobile/app/settings.tsx");
    const about = readRepoFile("apps/mobile/app/about.tsx");
    const maxBuy = readRepoFile("apps/mobile/app/max-buy-rules.tsx");

    expect(header).toContain("export function leavePreferencesStack");
    expect(header).toContain("router.canGoBack()");
    expect(header).toContain("router.back()");
    expect(header).toContain('router.replace("/(tabs)/collection")');
    expect(header).not.toMatch(CRM_WRITE_PATTERN);
    expect(header).not.toContain("saveMaxBuyPreferences");

    expect(settings).toContain("PreferencesScreenHeader");
    expect(settings).toContain('dismiss="close"');
    expect(settings).not.toMatch(CRM_WRITE_PATTERN);

    expect(about).toContain("PreferencesScreenHeader");
    expect(about).toContain('dismiss="back"');
    expect(about).not.toMatch(CRM_WRITE_PATTERN);

    expect(maxBuy).toContain("PreferencesScreenHeader");
    expect(maxBuy).toContain('dismiss="back"');
    expect(maxBuy).not.toMatch(CRM_WRITE_PATTERN);

    const focusStart = maxBuy.indexOf("useFocusEffect(");
    const focusEnd = maxBuy.indexOf("async function onSave");
    expect(focusStart).toBeGreaterThan(-1);
    expect(focusEnd).toBeGreaterThan(focusStart);
    expect(maxBuy.slice(focusStart, focusEnd)).not.toContain("saveMaxBuyPreferences");
    expect(maxBuy).toContain("await saveMaxBuyPreferences(parsed.preferences)");
  });
});
