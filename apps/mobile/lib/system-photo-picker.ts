import * as ImagePicker from "expo-image-picker";

/**
 * System photo picker (iOS PHPicker / Android Photo Picker).
 * Does not request media-library permission — the OS picker grants one-shot
 * access to the photo the user selects, so READ_MEDIA_IMAGES and
 * READ_EXTERNAL_STORAGE stay out of the manifest.
 */
const SYSTEM_PICKER: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  allowsEditing: false,
  allowsMultipleSelection: false,
  quality: 0.8,
  preferredAssetRepresentationMode:
    ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

export async function launchSystemImagePicker(
  options: ImagePicker.ImagePickerOptions = SYSTEM_PICKER,
): Promise<ImagePicker.ImagePickerAsset | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    ...SYSTEM_PICKER,
    ...options,
  });
  if (picked.canceled) return null;
  return picked.assets[0] ?? null;
}
