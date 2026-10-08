import {
  CARD_ASPECT_RATIO,
  GRADE_IMAGE_MAX_BYTES,
  GRADE_STILL_QUALITY,
  isGradeImageMime,
} from "@cardflow/shared";
import * as ImagePicker from "expo-image-picker";
import { Alert, Platform } from "react-native";

export interface PickedGradeStill {
  uri: string;
  mimeType: string | null;
}

export { CARD_ASPECT_RATIO, GRADE_STILL_QUALITY };

const STILL_PICKER: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  allowsEditing: false,
  allowsMultipleSelection: false,
  quality: GRADE_STILL_QUALITY,
  // iOS library photos are often HEIC. The offline grader (OpenCV) reads
  // JPEG/PNG/WebP only, so ask iOS for a compatible JPEG instead.
  preferredAssetRepresentationMode:
    ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

function mimeFromPickerAsset(asset: ImagePicker.ImagePickerAsset): string | null {
  const mime = asset.mimeType?.toLowerCase().split(";")[0]?.trim() ?? "";
  if (mime === "image/jpg" || mime === "image/jpeg") return "image/jpeg";
  if (mime === "image/png") return "image/png";
  if (mime === "image/webp") return "image/webp";
  const path = (asset.fileName ?? asset.uri).split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return mime || null;
}

export function validatePickedGradeStill(
  asset: ImagePicker.ImagePickerAsset | undefined,
): { still: PickedGradeStill } | { error: string } {
  if (!asset?.uri) return { error: "Could not read that photo. Try another." };
  if (typeof asset.fileSize === "number" && asset.fileSize > GRADE_IMAGE_MAX_BYTES) {
    return { error: "Image must be 20 MB or smaller" };
  }
  const mimeType = mimeFromPickerAsset(asset);
  if (mimeType && !isGradeImageMime(mimeType)) {
    return {
      error:
        mimeType === "image/heic" || mimeType === "image/heif"
          ? "HEIC photos can't be graded. Take the photo in the app, or set Camera > Formats to Most Compatible."
          : "Image must be jpeg, png, or webp",
    };
  }
  return { still: { uri: asset.uri, mimeType } };
}

export function stillFromCameraCapture(input: {
  uri: string | null | undefined;
  format?: "jpg" | "png";
  fileSize?: number;
}): { still: PickedGradeStill } | { error: string } {
  if (!input.uri) return { error: "Could not take a photo. Try again." };
  if (typeof input.fileSize === "number" && input.fileSize > GRADE_IMAGE_MAX_BYTES) {
    return { error: "Image must be 20 MB or smaller" };
  }
  return {
    still: {
      uri: input.uri,
      mimeType: input.format === "png" ? "image/png" : "image/jpeg",
    },
  };
}

async function pickFromLibrary(): Promise<ImagePicker.ImagePickerAsset | null> {
  if (Platform.OS === "ios" || Platform.OS === "android") {
    const media = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!media.granted) {
      throw new Error(
        "Photo library access is off. Enable it in system Settings, or take a still photo.",
      );
    }
  }
  const picked = await ImagePicker.launchImageLibraryAsync(STILL_PICKER);
  if (picked.canceled) return null;
  return picked.assets[0] ?? null;
}

async function pickFromCamera(): Promise<ImagePicker.ImagePickerAsset | null> {
  const camera = await ImagePicker.requestCameraPermissionsAsync();
  if (!camera.granted) {
    throw new Error(
      "Camera access is off. Enable it in system Settings, or pick a photo from the library.",
    );
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
  return validatePickedGradeStill(asset);
}

export function promptGradeStillSource(
  onPick: (source: "library" | "camera") => void,
): void {
  if (Platform.OS === "web") {
    onPick("library");
    return;
  }
  Alert.alert("Add photo", "Library or camera still. Catalog art is never the grade photo.", [
    { text: "Take photo", onPress: () => onPick("camera") },
    { text: "Choose photo", onPress: () => onPick("library") },
    { text: "Cancel", style: "cancel" },
  ]);
}
