import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRODUCTION_API_URL, configuredApiUrlFor, releaseApiUrlProblem } from "./client-api-url";
import { TCGPLAYER_NOTICE } from "./terms";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

describe("release API URL", () => {
  it("production defaults to the public API; preview and dev get no default", () => {
    expect(PRODUCTION_API_URL).toBe("https://api.pokesniper.app");
    expect(configuredApiUrlFor(undefined, "production")).toBe(PRODUCTION_API_URL);
    expect(configuredApiUrlFor(" https://staging.example.com ", "production")).toBe("https://staging.example.com");
    expect(configuredApiUrlFor(undefined, "preview")).toBe("");
    expect(configuredApiUrlFor(undefined, undefined)).toBe("");
    expect(releaseApiUrlProblem({ configured: configuredApiUrlFor(undefined, "production"), isDev: false })).toBeNull();
    expect(releaseApiUrlProblem({ configured: configuredApiUrlFor(undefined, "preview"), isDev: false })).toBe("missing");
  });
});

describe("TCGplayer attribution", () => {
  it("uses the exact required notice", () => {
    expect(TCGPLAYER_NOTICE).toBe("This product uses TCGplayer data but is not endorsed or certified by TCGplayer.");
    expect(read("apps/mobile/components/ui/tcgplayer-attribution.tsx")).toContain("TCGPLAYER_NOTICE");
  });
  it("appears on every screen that shows a TCGplayer price", () => {
    for (const file of [
      "apps/mobile/app/(tabs)/shop/card.tsx",
      "apps/mobile/app/(tabs)/collection.tsx",
      "apps/mobile/app/decide/[cardflowCardId].tsx",
      "apps/mobile/app/scan-summary/[scanId].tsx",
      "apps/mobile/components/ui/prepare-sheet.tsx",
      "apps/mobile/components/ui/screener-overlay.tsx",
    ]) {
      expect(read(file), file).toContain("<TcgplayerAttribution");
    }
  });
});

describe("IAP off: no placeholder prices", () => {
  it("PremiumPrompt shows plans only when IAP is on, else Subscriptions are opening soon.", () => {
    const src = read("apps/mobile/components/ui/premium-prompt.tsx");
    expect(src).toMatch(/iapOn \? <Text[^>]*>\{PREMIUM_PROMPT_COPY\.plans\}/);
    expect(src).toContain("LIVESTREAM_PAYWALL_COPY.openingSoon");
    expect(read("apps/mobile/components/ui/livestream-paywall.tsx")).toMatch(/iapOn \? \(\s*<>\s*<Text[^>]*>\{LIVESTREAM_PAYWALL_COPY\.plans\}/);
  });
  it("no screen hardcodes a placeholder price", () => {
    for (const file of ["apps/mobile/components/ui/premium-prompt.tsx", "apps/mobile/components/ui/livestream-paywall.tsx"]) {
      expect(read(file)).not.toMatch(/\$\d/);
    }
  });
});

describe("Live Scan kill switch (app)", () => {
  it("scan tab and tab button honor the server flag", () => {
    expect(read("apps/mobile/app/(tabs)/scan-tab.tsx")).toContain("useLivestreamEnabled()");
    expect(read("apps/mobile/app/(tabs)/scan-tab.tsx")).toContain("LIVESTREAM_DISABLED_COPY");
    expect(read("apps/mobile/components/ui/app-tab-bar.tsx")).toContain("useLivestreamEnabled()");
    expect(read("apps/mobile/lib/api.ts")).toContain("markLivestreamDisabled()");
  });
});
