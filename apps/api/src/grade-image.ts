import { GRADE_SIDES, type GradeSide } from "@cardflow/shared";
import { scanImageExtension, type ScanImageBytes, type ScanImageMimeType } from "./scan-image";

export type GradeImageBytes = ScanImageBytes;

export function isGradePhotoSide(value: string | undefined): value is GradeSide {
  return (GRADE_SIDES as readonly string[]).includes(value ?? "");
}

/** First-party object key, never a vendor or catalog URL. */
export function safeGradeInventoryId(inventoryItemId: string): string {
  const safe = inventoryItemId.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  return safe.length > 0 ? safe.slice(0, 80) : "item";
}

export function gradeImageStorageRef(
  inventoryItemId: string,
  side: GradeSide,
  mimeType: ScanImageMimeType,
): string {
  return `grade/${safeGradeInventoryId(inventoryItemId)}-${side}${scanImageExtension(mimeType)}`;
}

export function isFirstPartyGradeImageRef(storageRef: string): boolean {
  return /^grade\/[A-Za-z0-9._-]+-(front|back)\.(jpg|png|webp)$/i.test(storageRef);
}

export function mimeFromGradeStorageRef(storageRef: string): ScanImageMimeType | null {
  if (!isFirstPartyGradeImageRef(storageRef)) return null;
  const lowered = storageRef.toLowerCase();
  if (lowered.endsWith(".png")) return "image/png";
  if (lowered.endsWith(".webp")) return "image/webp";
  if (lowered.endsWith(".jpg")) return "image/jpeg";
  return null;
}

export function gradeImageStorageCandidates(
  inventoryItemId: string,
  side: GradeSide,
): string[] {
  return [
    gradeImageStorageRef(inventoryItemId, side, "image/jpeg"),
    gradeImageStorageRef(inventoryItemId, side, "image/png"),
    gradeImageStorageRef(inventoryItemId, side, "image/webp"),
  ];
}
