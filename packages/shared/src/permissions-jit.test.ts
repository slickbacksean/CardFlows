import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ANDROID_BLOCKED_PHOTO_PERMISSIONS,
  CAMERA_ALLOW_LABEL,
  CAMERA_DENIED_BODY,
  CAMERA_DENIED_TITLE,
  CAMERA_PREPROMPT_BODY,
  CAMERA_PREPROMPT_TITLE,
  CAMERA_USAGE_DESCRIPTION,
  GRADE_CAMERA_PREPROMPT_BODY,
  GRADE_CAMERA_PREPROMPT_TITLE,
  MOTION_USAGE_DESCRIPTION,
  OPEN_SETTINGS_LABEL,
  SEARCH_BY_NAME_LABEL,
} from "./permission-copy";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readAppConfig(): {
  expo: {
    ios?: { infoPlist?: Record<string, string> };
    android?: { permissions?: string[]; blockedPermissions?: string[] };
    plugins?: unknown[];
  };
} {
  return JSON.parse(readRepoFile("apps/mobile/app.json")) as ReturnType<typeof readAppConfig>;
}

function pluginConfig(plugins: unknown[], name: string): unknown {
  for (const plugin of plugins) {
    if (plugin === name) return true;
    if (Array.isArray(plugin) && plugin[0] === name) return plugin[1] ?? true;
  }
  return undefined;
}

describe("P0-06 just-in-time permissions", () => {
  it("asks for nothing at launch", () => {
    const layout = readRepoFile("apps/mobile/app/_layout.tsx");
    const tabs = readRepoFile("apps/mobile/app/(tabs)/_layout.tsx");
    const collection = readRepoFile("apps/mobile/app/(tabs)/collection.tsx");
    const capture = readRepoFile("apps/mobile/app/capture.tsx");
    const finder = readRepoFile("apps/mobile/components/ui/grade-card-finder.tsx");

    expect(layout).not.toMatch(
      /useCameraPermissions|requestCameraPermissions|requestMediaLibrary|DeviceMotion|expo-sensors/,
    );
    expect(tabs).not.toMatch(
      /useCameraPermissions|requestCameraPermissions|requestMediaLibrary|DeviceMotion|expo-sensors/,
    );
    expect(collection).not.toMatch(
      /useCameraPermissions|requestCameraPermissions|requestMediaLibrary/,
    );
    expect(capture).not.toMatch(/useEffect\([\s\S]*requestPermission/);
    expect(finder).not.toMatch(/useEffect\([\s\S]*requestPermission/);
  });

  it("precedes every camera request with a pre-prompt", () => {
    const capture = readRepoFile("apps/mobile/app/capture.tsx");
    const finder = readRepoFile("apps/mobile/components/ui/grade-card-finder.tsx");
    const photos = readRepoFile("apps/mobile/lib/grade-photos.ts");
    const gate = readRepoFile("apps/mobile/components/ui/permission-gate.tsx");

    expect(capture).toContain("showCameraPreprompt");
    expect(capture).toContain("CAMERA_PREPROMPT_TITLE");
    expect(capture).toContain("CAMERA_PREPROMPT_BODY");
    expect(capture).toContain("confirmCameraPreprompt");
    expect(capture).toContain("setShowCameraPreprompt(true)");
    expect(capture).toContain("await requestPermission()");
    expect(capture).not.toContain("void requestPermission()");

    expect(finder).toContain("GRADE_CAMERA_PREPROMPT_TITLE");
    expect(finder).toContain("GRADE_CAMERA_PREPROMPT_BODY");
    expect(finder).toContain("CAMERA_ALLOW_LABEL");
    expect(finder).toContain("void requestPermission()");
    expect(finder).not.toMatch(/useEffect\(/);

    expect(photos).toContain("CAMERA_PREPROMPT_TITLE");
    expect(photos).toContain("CAMERA_PREPROMPT_BODY");
    expect(photos).toContain("Alert.alert(CAMERA_PREPROMPT_TITLE");
    expect(photos).toContain("requestCameraPermissionsAsync");

    expect(gate).toContain("onContinue");
    expect(CAMERA_PREPROMPT_TITLE.length).toBeGreaterThan(8);
    expect(CAMERA_PREPROMPT_BODY).toMatch(/camera/i);
    expect(GRADE_CAMERA_PREPROMPT_TITLE).toBe(CAMERA_ALLOW_LABEL);
    expect(GRADE_CAMERA_PREPROMPT_BODY).toMatch(/library photo/i);
  });

  it("uses the system photo picker and drops broad Android photo permissions", () => {
    const config = readAppConfig();
    const capture = readRepoFile("apps/mobile/app/capture.tsx");
    const photos = readRepoFile("apps/mobile/lib/grade-photos.ts");
    const picker = readRepoFile("apps/mobile/lib/system-photo-picker.ts");
    const imagePicker = pluginConfig(config.expo.plugins ?? [], "expo-image-picker") as {
      photosPermission?: unknown;
      cameraPermission?: unknown;
    };

    expect(picker).toContain("launchImageLibraryAsync");
    expect(picker).not.toContain("requestMediaLibraryPermissionsAsync");
    expect(capture).toContain("launchSystemImagePicker");
    expect(capture).not.toContain("requestMediaLibraryPermissionsAsync");
    expect(photos).toContain("launchSystemImagePicker");
    expect(photos).not.toContain("requestMediaLibraryPermissionsAsync");

    expect(imagePicker.photosPermission).toBe(false);
    expect(imagePicker.cameraPermission).toBe(false);
    expect(config.expo.ios?.infoPlist?.NSPhotoLibraryUsageDescription).toBeUndefined();
    const addedAndroidPermissions = config.expo.android?.permissions ?? [];
    for (const permission of ANDROID_BLOCKED_PHOTO_PERMISSIONS) {
      expect(addedAndroidPermissions).not.toContain(permission);
      expect(config.expo.android?.blockedPermissions).toContain(permission);
    }
  });

  it("falls back to library or search by name when camera is denied", () => {
    const capture = readRepoFile("apps/mobile/app/capture.tsx");
    const finder = readRepoFile("apps/mobile/components/ui/grade-card-finder.tsx");
    const gate = readRepoFile("apps/mobile/components/ui/permission-gate.tsx");
    const photos = readRepoFile("apps/mobile/lib/grade-photos.ts");

    expect(capture).toContain("CAMERA_DENIED_TITLE");
    expect(capture).toContain("CAMERA_DENIED_BODY");
    expect(capture).toContain("onSearchByName");
    expect(capture).toContain('router.replace("/(tabs)/shop")');
    expect(capture).toContain("onChoosePhoto");
    expect(capture).toContain("onOpenSettings");
    expect(finder).toContain("CAMERA_DENIED_TITLE");
    expect(finder).toContain("OPEN_SETTINGS_LABEL");
    expect(finder).toContain("CHOOSE_A_PHOTO_LABEL");
    expect(gate).toContain("OPEN_SETTINGS_LABEL");
    expect(gate).toContain("SEARCH_BY_NAME_LABEL");
    expect(photos).toContain("CAMERA_OFF_PICKER_FALLBACK");
    expect(CAMERA_DENIED_TITLE).toBe("Camera access is off.");
    expect(CAMERA_DENIED_BODY).toMatch(/library/);
    expect(OPEN_SETTINGS_LABEL).toBe("Open system Settings");
    expect(SEARCH_BY_NAME_LABEL).toBe("Search by name");
  });

  it("declares only camera and motion usage strings the app uses", () => {
    const config = readAppConfig();
    const camera = pluginConfig(config.expo.plugins ?? [], "expo-camera") as {
      cameraPermission?: string;
      microphonePermission?: unknown;
      recordAudioAndroid?: unknown;
    };
    const sensors = pluginConfig(config.expo.plugins ?? [], "expo-sensors") as {
      motionPermission?: string;
    };
    const imagePicker = pluginConfig(config.expo.plugins ?? [], "expo-image-picker") as {
      photosPermission?: unknown;
      microphonePermission?: unknown;
    };

    expect(config.expo.ios?.infoPlist?.NSCameraUsageDescription).toBe(CAMERA_USAGE_DESCRIPTION);
    expect(config.expo.ios?.infoPlist?.NSMotionUsageDescription).toBe(MOTION_USAGE_DESCRIPTION);
    expect(config.expo.ios?.infoPlist?.NSPhotoLibraryUsageDescription).toBeUndefined();
    expect(config.expo.ios?.infoPlist?.NSMicrophoneUsageDescription).toBeUndefined();
    expect(camera.cameraPermission).toBe(CAMERA_USAGE_DESCRIPTION);
    expect(camera.microphonePermission).toBe(false);
    expect(camera.recordAudioAndroid).toBe(false);
    expect(sensors.motionPermission).toBe(MOTION_USAGE_DESCRIPTION);
    expect(imagePicker.photosPermission).toBe(false);
    expect(imagePicker.microphonePermission).toBe(false);
    expect(MOTION_USAGE_DESCRIPTION).toBe(
      "PokeSniper uses motion to help you hold your phone level over a card.",
    );
  });

  it("keeps Expo Go compatible when PR 39 DeviceMotion is unmerged", () => {
    const capture = readRepoFile("apps/mobile/app/capture.tsx");
    const finder = readRepoFile("apps/mobile/components/ui/grade-card-finder.tsx");
    const photos = readRepoFile("apps/mobile/lib/grade-photos.ts");
    const picker = readRepoFile("apps/mobile/lib/system-photo-picker.ts");
    const mobilePackage = readRepoFile("apps/mobile/package.json");

    expect(capture).toContain('from "expo-camera"');
    expect(capture).not.toMatch(/from\s+["']expo-sensors["']/);
    expect(finder).toContain('from "expo-camera"');
    expect(finder).not.toMatch(/from\s+["']expo-sensors["']/);
    expect(photos).toContain('from "expo-image-picker"');
    expect(picker).toContain('from "expo-image-picker"');
    expect(mobilePackage).toContain("expo-sensors");
    // Optional native loader from PR 39 — present or not, this PR must not import sensors.
    if (existsSync(path.join(repoRoot, "apps/mobile/lib/device-level.ts"))) {
      const deviceLevel = readRepoFile("apps/mobile/lib/device-level.ts");
      expect(deviceLevel).toContain("requireOptionalNativeModule");
      expect(deviceLevel).not.toMatch(/from\s+["']expo-sensors["']\s*;/);
    }
  });
});
