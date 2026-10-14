import {
  CAMERA_OFF_PICKER_FALLBACK,
  CAMERA_PREPROMPT_BODY,
  CAMERA_PREPROMPT_TITLE,
  CARD_ASPECT_RATIO,
  CHOOSE_PHOTO_LABEL,
  GRADE_IMAGE_MAX_BYTES,
  GRADE_STILL_QUALITY,
  GRADE_STILL_MIN_SHORT_SIDE_PX,
  GRADE_STILL_TOO_SMALL_COPY,
  gradeStillResizeAction,
  isGradeImageMime,
  largestPictureSize,
  stillFromCameraCapture,
  type PickedGradeStill,
} from "@cardflow/shared";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Alert, Image, Platform } from "react-native";
import { launchSystemImagePicker } from "@/lib/system-photo-picker";

export type { PickedGradeStill };
export {
  CARD_ASPECT_RATIO,
  GRADE_STILL_MIN_SHORT_SIDE_PX,
  GRADE_STILL_QUALITY,
  largestPictureSize,
  stillFromCameraCapture,
};

const CONVERTIBLE_MIME = new Set(["image/heic", "image/heif", "image/heic-sequence"]);

const STILL_PICKER: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  allowsEditing: false,
  allowsMultipleSelection: false,
  // Full pixels here; `prepareGradeStill` writes JPEG q=0.8 once (and strips EXIF).
  quality: 1,
  // iOS library photos are often HEIC. Compatible mode prefers JPEG; prep still
  // converts whatever lands so Expo Go can upload a JPEG.
  preferredAssetRepresentationMode:
    ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

function mimeFromPickerAsset(asset: ImagePicker.ImagePickerAsset): string | null {
  const mime = asset.mimeType?.toLowerCase().split(";")[0]?.trim() ?? "";
  if (mime === "image/jpg" || mime === "image/jpeg") return "image/jpeg";
  if (mime === "image/png") return "image/png";
  if (mime === "image/webp") return "image/webp";
  if (CONVERTIBLE_MIME.has(mime)) return mime;
  const path = (asset.fileName ?? asset.uri).split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".heic") || path.endsWith(".heif")) return "image/heic";
  return mime || null;
}

export function validatePickedGradeStill(
  asset: ImagePicker.ImagePickerAsset | undefined,
): { still: PickedGradeStill } | { error: string } {
  if (!asset?.uri) return { error: "Could not read that photo. Try another." };
  if (typeof asset.fileSize === "number" && asset.fileSize > GRADE_IMAGE_MAX_BYTES) {
    return { error: "Image must be 20 MB or smaller" };
  }
  if (
    typeof asset.width === "number" &&
    typeof asset.height === "number" &&
    asset.width > 0 &&
    asset.height > 0 &&
    Math.min(asset.width, asset.height) < GRADE_STILL_MIN_SHORT_SIDE_PX
  ) {
    return { error: GRADE_STILL_TOO_SMALL_COPY };
  }
  const mimeType = mimeFromPickerAsset(asset);
  if (mimeType && !isGradeImageMime(mimeType) && !CONVERTIBLE_MIME.has(mimeType)) {
    return { error: "Image must be jpeg, png, or webp" };
  }
  return {
    still: {
      uri: asset.uri,
      mimeType,
      width: asset.width,
      height: asset.height,
    },
  };
}

async function stillDimensions(
  uri: string,
  width?: number,
  height?: number,
): Promise<{ width: number; height: number } | null> {
  if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
    return { width, height };
  }
  try {
    return await new Promise((resolve, reject) => {
      Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject);
    });
  } catch {
    return null;
  }
}

/**
 * Convert HEIC (and anything else the manipulator can open) to JPEG q=0.8,
 * downscale long edge to 4032 px, and re-encode so EXIF/GPS are dropped.
 * Uses expo-image-manipulator, which ships in Expo Go.
 */
export async function prepareGradeStill(input: {
  uri: string;
  mimeType?: string | null;
  width?: number;
  height?: number;
}): Promise<{ still: PickedGradeStill } | { error: string }> {
  if (!input.uri) return { error: "Could not read that photo. Try another." };
  try {
    const size = await stillDimensions(input.uri, input.width, input.height);
    const resize = size ? gradeStillResizeAction(size.width, size.height) : null;
    const result = await manipulateAsync(input.uri, resize ? [resize] : [], {
      compress: GRADE_STILL_QUALITY,
      format: SaveFormat.JPEG,
    });
    if (
      result.width > 0 &&
      result.height > 0 &&
      Math.min(result.width, result.height) < GRADE_STILL_MIN_SHORT_SIDE_PX
    ) {
      return { error: GRADE_STILL_TOO_SMALL_COPY };
    }
    return {
      still: {
        uri: result.uri,
        mimeType: "image/jpeg",
        width: result.width,
        height: result.height,
      },
    };
  } catch {
    return {
      error: "Could not prepare that photo. Try another, or take it in the app.",
    };
  }
}

async function pickFromLibrary(): Promise<ImagePicker.ImagePickerAsset | null> {
  return launchSystemImagePicker(STILL_PICKER);
}

async function pickFromCamera(): Promise<ImagePicker.ImagePickerAsset | null> {
  const camera = await ImagePicker.requestCameraPermissionsAsync();
  if (!camera.granted) {
    throw new Error(CAMERA_OFF_PICKER_FALLBACK);
  }
  const taken = await ImagePicker.launchCameraAsync(STILL_PICKER);
  if (taken.canceled) return null;
  return taken.assets[0] ?? null;
}

export async function pickGradeStill(
  source: "library" | "camera",
): Promise<{ still: PickedGradeStill } | { error: string } | null> {
  const asset = source === "camera" ? await pickFromCamera() : await pickFromLibrary();
  if (!asset) return null;
  const validated = validatePickedGradeStill(asset);
  if ("error" in validated) return validated;
  return prepareGradeStill(validated.still);
}

export function promptGradeStillSource(
  onPick: (source: "library" | "camera") => void,
): void {
  if (Platform.OS === "web") {
    onPick("library");
    return;
  }
  Alert.alert(CAMERA_PREPROMPT_TITLE, CAMERA_PREPROMPT_BODY, [
    { text: "Take photo", onPress: () => onPick("camera") },
    { text: CHOOSE_PHOTO_LABEL, onPress: () => onPick("library") },
    { text: "Cancel", style: "cancel" },
  ]);
}
