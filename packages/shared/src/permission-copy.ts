/**
 * Just-in-time permission copy (P0-06). Camera, motion, and the system photo
 * picker. The OS dialog is never the first explanation — a short in-app
 * pre-prompt always comes first. Denied camera still leaves a working path:
 * pick a photo or search by name.
 */
/** Sean: permission text names where photos go (CardSight is named in the consent prompt). */
export const PHOTO_PERMISSION_PURPOSE =
  "Photos are uploaded to CardFlow, and to our card-recognition provider if you allow it, to identify your cards and prepare grade photos." as const;

export const CAMERA_USAGE_DESCRIPTION =
  "CardFlow uses the camera to photograph your Pokémon cards. Photos are uploaded to CardFlow, and to our card-recognition provider if you allow it, to identify your cards and prepare grade photos." as const;

export const MOTION_USAGE_DESCRIPTION =
  "CardFlow uses motion to help you hold your phone level over a card." as const;

export const CAMERA_PREPROMPT_TITLE = "Take a photo of a card" as const;
export const CAMERA_PREPROMPT_BODY =
  "CardFlow uses the camera to photograph one English raw single. You can also pick a photo you already took, or search by name." as const;
export const CAMERA_PREPROMPT_CONTINUE = "Continue" as const;
export const CAMERA_ALLOW_LABEL = "Allow camera" as const;

export const GRADE_CAMERA_PREPROMPT_TITLE = "Allow camera" as const;
export const GRADE_CAMERA_PREPROMPT_BODY =
  "CardFlow takes a still of the card in a 63×88 frame, then finds the crop. You can also choose a library photo." as const;

export const CAMERA_DENIED_TITLE = "Camera access is off." as const;
export const CAMERA_DENIED_BODY =
  "Enable it in system Settings, or pick a photo from the library." as const;
export const OPEN_SETTINGS_LABEL = "Open system Settings" as const;
export const CHOOSE_PHOTO_LABEL = "Choose photo" as const;
export const CHOOSE_A_PHOTO_LABEL = "Choose a photo" as const;
export const SEARCH_BY_NAME_LABEL = "Search by name" as const;

export const CAMERA_OFF_PICKER_FALLBACK =
  "Camera access is off. Enable it in system Settings, or pick a photo from the library." as const;

export const PHOTO_PICKER_UNAVAILABLE_COPY =
  "Couldn't open the photo picker. Search by name, or type the card in manually." as const;

/** Android permissions the system photo picker makes unnecessary. */
export const ANDROID_BLOCKED_PHOTO_PERMISSIONS = [
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
] as const;
