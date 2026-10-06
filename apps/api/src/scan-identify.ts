import {
  stillIdentifySkippedResult,
  unconfiguredStillIdentifyResult,
  type CardFlowNormalizedRecognitionResult,
  type RecognitionImageMimeType,
  type RecognitionScenario,
} from "@cardflow/shared";
import { SCAN_IMAGE_MAX_BYTES, type ScanImageBytes } from "./scan-image";

const EMPTY_IDENTIFY_IMAGE = new Uint8Array();

export type ScanIdentifyDecision =
  | {
      action: "live";
      image: Uint8Array;
      mimeType: RecognitionImageMimeType;
    }
  | {
      action: "mock_scenario";
      image: Uint8Array;
      mimeType: RecognitionImageMimeType;
      scenario: RecognitionScenario;
    }
  | {
      action: "skip_model";
      reason: "missing_image" | "oversize_image";
    }
  | {
      action: "unconfigured";
    };

/**
 * Live Capture identify reads persisted `image_storage_ref` bytes.
 * JSON-only DEV chips skip live OBB/hash and keep the mock scenario.
 * Missing or oversize stored stills never run the model.
 */
export function decideScanIdentify(input: {
  liveIdentifyEnabled: boolean;
  /** JSON-only DEV chips. Production ignores scenario and never returns a fixture. */
  allowDevScenario: boolean;
  persistedStorageRef: string | null;
  stored: ScanImageBytes | undefined;
  scenario: RecognitionScenario;
}): ScanIdentifyDecision {
  const devChip = input.allowDevScenario && !input.persistedStorageRef;

  if (!input.liveIdentifyEnabled) {
    if (devChip) {
      return {
        action: "mock_scenario",
        image: input.stored?.bytes ?? EMPTY_IDENTIFY_IMAGE,
        mimeType: input.stored?.mimeType ?? "image/jpeg",
        scenario: input.scenario,
      };
    }
    return { action: "unconfigured" };
  }

  if (!input.persistedStorageRef) {
    if (devChip) {
      return {
        action: "mock_scenario",
        image: EMPTY_IDENTIFY_IMAGE,
        mimeType: "image/jpeg",
        scenario: input.scenario,
      };
    }
    return { action: "skip_model", reason: "missing_image" };
  }

  const stored = input.stored;
  if (!stored || stored.storageRef !== input.persistedStorageRef || stored.bytes.byteLength === 0) {
    return { action: "skip_model", reason: "missing_image" };
  }
  if (stored.bytes.byteLength > SCAN_IMAGE_MAX_BYTES) {
    return { action: "skip_model", reason: "oversize_image" };
  }
  return {
    action: "live",
    image: stored.bytes,
    mimeType: stored.mimeType,
  };
}

export function skippedStillIdentifyResult(
  reason: "missing_image" | "oversize_image",
): CardFlowNormalizedRecognitionResult {
  return stillIdentifySkippedResult(reason);
}

export function unconfiguredScanIdentifyResult(): CardFlowNormalizedRecognitionResult {
  return unconfiguredStillIdentifyResult();
}
