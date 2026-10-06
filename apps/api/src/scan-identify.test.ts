import { describe, expect, it } from "vitest";
import { SCAN_IMAGE_MAX_BYTES, scanImageStorageRef } from "./scan-image";
import { decideScanIdentify } from "./scan-identify";

const TINY_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const SCAN_ID = "11111111-1111-1111-1111-111111111111";
const STORAGE_REF = scanImageStorageRef(SCAN_ID, "image/jpeg");

describe("decideScanIdentify", () => {
  it("keeps mock scenario when live identify is off and DEV chips are allowed", () => {
    expect(
      decideScanIdentify({
        liveIdentifyEnabled: false,
        allowDevScenario: true,
        persistedStorageRef: null,
        stored: undefined,
        scenario: "ambiguous",
      }),
    ).toEqual({
      action: "mock_scenario",
      image: new Uint8Array(),
      mimeType: "image/jpeg",
      scenario: "ambiguous",
    });
  });

  it("skips live OBB/hash for JSON-only DEV chips and keeps the mock scenario", () => {
    expect(
      decideScanIdentify({
        liveIdentifyEnabled: true,
        allowDevScenario: true,
        persistedStorageRef: null,
        stored: undefined,
        scenario: "no-card",
      }),
    ).toEqual({
      action: "mock_scenario",
      image: new Uint8Array(),
      mimeType: "image/jpeg",
      scenario: "no-card",
    });
  });

  it("uses stored image_storage_ref bytes for live identify", () => {
    expect(
      decideScanIdentify({
        liveIdentifyEnabled: true,
        allowDevScenario: false,
        persistedStorageRef: STORAGE_REF,
        stored: { storageRef: STORAGE_REF, mimeType: "image/jpeg", bytes: TINY_JPEG },
        scenario: "high-confidence",
      }),
    ).toEqual({
      action: "live",
      image: TINY_JPEG,
      mimeType: "image/jpeg",
    });
  });

  it("does not run the model when the stored still is missing or oversize", () => {
    expect(
      decideScanIdentify({
        liveIdentifyEnabled: true,
        allowDevScenario: false,
        persistedStorageRef: STORAGE_REF,
        stored: undefined,
        scenario: "high-confidence",
      }),
    ).toEqual({ action: "skip_model", reason: "missing_image" });

    expect(
      decideScanIdentify({
        liveIdentifyEnabled: true,
        allowDevScenario: false,
        persistedStorageRef: STORAGE_REF,
        stored: {
          storageRef: STORAGE_REF,
          mimeType: "image/jpeg",
          bytes: new Uint8Array(SCAN_IMAGE_MAX_BYTES + 1),
        },
        scenario: "high-confidence",
      }),
    ).toEqual({ action: "skip_model", reason: "oversize_image" });
  });

  it("does not name a fixture when scenario is sent outside dev", () => {
    expect(
      decideScanIdentify({
        liveIdentifyEnabled: false,
        allowDevScenario: false,
        persistedStorageRef: null,
        stored: undefined,
        scenario: "high-confidence",
      }),
    ).toEqual({ action: "unconfigured" });

    expect(
      decideScanIdentify({
        liveIdentifyEnabled: true,
        allowDevScenario: false,
        persistedStorageRef: null,
        stored: undefined,
        scenario: "high-confidence",
      }),
    ).toEqual({ action: "skip_model", reason: "missing_image" });

    expect(
      decideScanIdentify({
        liveIdentifyEnabled: false,
        allowDevScenario: true,
        persistedStorageRef: STORAGE_REF,
        stored: { storageRef: STORAGE_REF, mimeType: "image/jpeg", bytes: TINY_JPEG },
        scenario: "high-confidence",
      }),
    ).toEqual({ action: "unconfigured" });
  });
});
