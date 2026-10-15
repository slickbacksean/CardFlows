import { PHONE_CHECK_LONG_SIDE, phonePhotoCheck, rgbaToGray, type PhoneCheckResult } from "@cardflow/shared";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import jpeg from "jpeg-js";

/**
 * P1-16: on-phone quality check for a Grade still. Downscales with
 * expo-image-manipulator (in Expo Go), decodes the tiny JPEG in plain JS and
 * runs the shared check. Any failure here returns null so the photo just goes
 * to the server, which always makes the final call.
 */
export async function checkGradeStillOnPhone(
  uri: string,
  options: { fromGuide: boolean },
): Promise<PhoneCheckResult | null> {
  try {
    const small = await manipulateAsync(uri, [{ resize: { height: PHONE_CHECK_LONG_SIDE } }], {
      compress: 0.9,
      format: SaveFormat.JPEG,
      base64: true,
    });
    if (!small.base64) return null;
    const bytes = base64ToBytes(small.base64);
    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    const gray = rgbaToGray(decoded.width, decoded.height, decoded.data);
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
