import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LIVESTREAM_SCANNER_UNAVAILABLE_DETAIL,
  LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE,
} from "./live-video-identity";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const mobileRoot = path.join(repoRoot, "apps/mobile");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function walkSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "ios" || name === "android") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walkSourceFiles(full, acc);
      continue;
    }
    if (/\.(ts|tsx|js|jsx)$/.test(name)) acc.push(full);
  }
  return acc;
}

const FORBIDDEN_IMPORT =
  /from\s+["']expo-sensors["']|from\s+["']@capacitor\/|from\s+["']@capgo\/|require\(\s*["']expo-sensors["']\s*\)/;

describe("Expo Go runtime guards", () => {
  it("feature-detects cardflow-live-video instead of throwing at import time", () => {
    const nativeJs = readRepoFile("apps/mobile/lib/live-video-native.ts");
    const moduleEntry = readRepoFile("apps/mobile/modules/cardflow-live-video/index.ts");
    const runtimeHost = readRepoFile("apps/mobile/lib/runtime-host.ts");
    const liveIdentify = readRepoFile("apps/mobile/lib/live-identify.ts");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const overlay = readRepoFile("apps/mobile/components/ui/screener-overlay.tsx");

    expect(runtimeHost).toContain("executionEnvironment");
    expect(runtimeHost).toContain("storeClient");
    expect(runtimeHost).toContain("appOwnership");
    expect(nativeJs).toContain("requireOptionalNativeModule");
    expect(nativeJs).toContain('requireOptionalNativeModule<T>(name)');
    expect(nativeJs).toContain("isExpoGoRuntime");
    expect(nativeJs).toContain("CardFlowLiveVideo");
    expect(nativeJs).toContain("EXPO_GO_OPTIONAL_NATIVE_MODULES");
    expect(nativeJs).not.toMatch(/requireNativeModule\s*[<(]/);
    expect(moduleEntry).not.toMatch(/requireNativeModule/);
    expect(liveIdentify).toContain("if (!isLiveVideoNativeAvailable())");
    expect(scanTab).toContain("isLiveVideoNativeAvailable");
    expect(scanTab).toContain("unavailableBanner");
    expect(scanTab).toContain("LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE");
    expect(scanTab).toContain("LIVESTREAM_SCANNER_UNAVAILABLE_DETAIL");
    expect(overlay).toContain("LIVESTREAM_SCANNER_UNAVAILABLE_DETAIL");
    expect(LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE).toBe(
      "Live card scanning needs a development build.",
    );
    expect(LIVESTREAM_SCANNER_UNAVAILABLE_DETAIL).toBe(
      "Native livestream frame capture is off. The live page still loads.",
    );
  });

  it("keeps grading on Expo Go camera modules and forbids removed native packages", () => {
    const finder = readRepoFile("apps/mobile/components/ui/grade-card-finder.tsx");
    const flow = readRepoFile("apps/mobile/components/ui/photo-grade-flow.tsx");
    const photos = readRepoFile("apps/mobile/lib/grade-photos.ts");
    const mobilePackage = readRepoFile("apps/mobile/package.json");
    const rootPackage = readRepoFile("package.json");

    expect(finder).toContain('from "expo-camera"');
    expect(finder).toContain("CameraView");
    expect(finder).not.toMatch(/cardflow-live-video|CardFlowLiveVideo|expo-sensors/);
    expect(flow).toContain("GradeCardFinder");
    expect(flow).not.toMatch(/cardflow-live-video|expo-sensors|@capacitor|@capgo/);
    expect(photos).toContain('from "expo-image-picker"');
    expect(photos).not.toMatch(/expo-sensors|@capacitor|@capgo/);
    expect(mobilePackage).not.toMatch(/expo-sensors|@capacitor|@capgo/);
    expect(rootPackage).not.toMatch(/expo-sensors|@capacitor\/|@capgo\//);

    const sources = walkSourceFiles(path.join(mobileRoot, "app"))
      .concat(walkSourceFiles(path.join(mobileRoot, "components")))
      .concat(walkSourceFiles(path.join(mobileRoot, "lib")));
    expect(sources.length).toBeGreaterThan(20);
    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(FORBIDDEN_IMPORT);
    }
  });
});
