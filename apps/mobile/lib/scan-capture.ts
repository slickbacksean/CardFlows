import { scanImageUri } from "./api";
import { prepareGradeStill, type PickedGradeStill } from "./grade-photos";

const urisByScanId = new Map<string, string>();

function asScanId(scanId: string | string[] | undefined): string | null {
  const id = Array.isArray(scanId) ? scanId[0] : scanId;
  return id ? id : null;
}

export function rememberScanCapture(scanId: string, uri: string): void {
  urisByScanId.set(scanId, uri);
}

export function getScanCaptureUri(scanId: string | string[] | undefined): string | null {
  const id = asScanId(scanId);
  if (!id) return null;
  return urisByScanId.get(id) ?? null;
}

/** Local still first; first-party scan image if the device URI is gone. Never catalog art. */
export function getConfirmPictureUri(
  scanId: string | string[] | undefined,
  imageStorageRef: string | null | undefined,
): string | null {
  const local = getScanCaptureUri(scanId);
  if (local) return local;
  const id = asScanId(scanId);
  if (id && imageStorageRef) return scanImageUri(id);
  return null;
}

/**
 * Same phone-side prep as grade stills: HEIC→JPEG, long edge ≤4032, q=0.8, no EXIF.
 * Capture and Confirm upload this JPEG once.
 */
export async function prepareScanStill(
  uri: string,
  mimeType?: string | null,
  size?: { width?: number; height?: number },
): Promise<{ still: PickedGradeStill } | { error: string }> {
  return prepareGradeStill({
    uri,
    mimeType,
    width: size?.width,
    height: size?.height,
  });
}
