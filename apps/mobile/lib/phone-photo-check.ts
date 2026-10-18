import {
  gradeProbeDetail,
  type GradeProbeDetail,
  PHONE_CHECK_LONG_SIDE,
  phonePhotoCheck,
  rgbaToGray,
  type GrayImage,
  type PhoneCheckResult,
} from "@cardflow/shared";
import { File } from "expo-file-system";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import jpeg from "jpeg-js";

/**
 * P1-16: on-phone quality check for a Grade still. Downscales with
 * expo-image-manipulator (in Expo Go), decodes the tiny JPEG in plain JS and
 * runs the shared check. Any failure here returns null so the photo just goes
 * to the server, which always makes the final call.
 */
async function smallGray(uri: string): Promise<GrayImage | null> {
  const small = await manipulateAsync(uri, [{ resize: { height: PHONE_CHECK_LONG_SIDE } }], {
    compress: 0.9,
    format: SaveFormat.JPEG,
    base64: true,
  });
  deleteQuietly(small.uri);
  if (!small.base64) return null;
  const decoded = jpeg.decode(base64ToBytes(small.base64), { useTArray: true, formatAsRGBA: true });
  return rgbaToGray(decoded.width, decoded.height, decoded.data);
}

function deleteQuietly(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // cache files are cleaned up by the OS anyway
  }
}

/**
 * Auto-capture corner probe on a small preview still: corners (0-4),
 * sharpness, and whether it was too blurry to judge; null if the check
 * failed. Logs one line per probe. The probe still is deleted either way.
 */
export async function probeGradeCorners(uri: string, frameFill: number | null): Promise<GradeProbeDetail | null> {
  try {
    const gray = await smallGray(uri);
    if (!gray) return null;
    const detail = gradeProbeDetail(gray, frameFill ?? undefined);
    console.info(
      `grade-probe corners=${detail.corners} sharpness=${detail.sharpness} blurry=${detail.blurry} size=${gray.width}x${gray.height}`,
    );
    return detail;
  } catch {
    return null;
  } finally {
    deleteQuietly(uri);
  }
}

export async function checkGradeStillOnPhone(
  uri: string,
  options: { fromGuide: boolean },
): Promise<PhoneCheckResult | null> {
  try {
    const gray = await smallGray(uri);
    if (!gray) return null;
    const result = phonePhotoCheck(gray);
    if (options.fromGuide) return result;
    // Library photos weren't taken against the guide frame, so only blur and "nothing there" apply.
    const reasons = result.reasons.filter((r) => !/whole card/i.test(r));
    return { ...result, ok: reasons.length === 0, reasons };
  } catch {
    return null;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
