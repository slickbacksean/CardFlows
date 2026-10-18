import { GRADE_ESTIMATE_UNAVAILABLE_COPY, type CardFlowGradeEstimate } from "./grade-estimate";

/**
 * Batch pre-grade queue + batch scan session. Runs one card at a time over
 * stored photos (no new native code). Estimates only, never an official grade.
 */
export const BATCH_QUEUE_TITLE = "Batch pre-grade";
export const BATCH_QUEUE_NOTE = "Pre-grade estimate for each card. Estimate only. Not an official grade.";
export const BATCH_STOP_AFTER_UNAVAILABLE = 2;

export interface BatchCandidate {
  inventoryItemId: string;
  intent: string;
  createdAt: string;
  imageStorageRef?: string | null;
  gradePhotos?: { front: boolean; back: boolean } | null;
}

export type BatchItemStatus = "queued" | "running" | "done" | "no_estimate" | "unavailable" | "skipped";

export interface BatchItem {
  inventoryItemId: string;
  status: BatchItemStatus;
  display: string | null;
}

export function hasStoredFront(candidate: BatchCandidate): boolean {
  return Boolean(candidate.gradePhotos?.front || candidate.imageStorageRef);
}

/** Purchased cards with a stored front photo, oldest first. A session keeps only cards added since it started. */
export function batchCandidates<T extends BatchCandidate>(
  items: readonly T[],
  sessionStartedAt?: string | null,
): T[] {
  const since = sessionStartedAt ? Date.parse(sessionStartedAt) : Number.NaN;
  return items
    .filter((item) => item.intent === "purchased" && hasStoredFront(item))
    .filter((item) => Number.isNaN(since) || Date.parse(item.createdAt) >= since)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export function statusFor(estimate: CardFlowGradeEstimate): BatchItemStatus {
  if (estimate.overall != null && estimate.overall >= 1) return "done";
  if (estimate.display === GRADE_ESTIMATE_UNAVAILABLE_COPY) return "unavailable";
  return "no_estimate";
}

/** Sequential run. Stops early (rest marked skipped) after repeated unavailable results or on cancel. */
export async function runBatchQueue(
  ids: readonly string[],
  estimate: (inventoryItemId: string) => Promise<CardFlowGradeEstimate>,
  onUpdate: (items: BatchItem[]) => void,
  shouldCancel: () => boolean = () => false,
): Promise<BatchItem[]> {
  const items: BatchItem[] = ids.map((id) => ({ inventoryItemId: id, status: "queued", display: null }));
  const publish = () => onUpdate(items.map((item) => ({ ...item })));
  publish();
  let unavailableRun = 0;
  for (let index = 0; index < items.length; index += 1) {
    if (shouldCancel() || unavailableRun >= BATCH_STOP_AFTER_UNAVAILABLE) {
      for (let rest = index; rest < items.length; rest += 1) items[rest]!.status = "skipped";
      break;
    }
    const item = items[index]!;
    item.status = "running";
    publish();
    let result: CardFlowGradeEstimate | null = null;
    try {
      result = await estimate(item.inventoryItemId);
    } catch {
      result = null;
    }
    item.status = result ? statusFor(result) : "unavailable";
    item.display = result?.display ?? null;
    unavailableRun = item.status === "unavailable" ? unavailableRun + 1 : 0;
    publish();
  }
  publish();
  return items;
}

export function batchSummary(items: readonly BatchItem[]): string {
  const count = (status: BatchItemStatus) => items.filter((item) => item.status === status).length;
  const parts = [`${count("done")} of ${items.length} estimated`];
  if (count("no_estimate")) parts.push(`${count("no_estimate")} need a retake`);
  if (count("unavailable")) parts.push(`${count("unavailable")} unavailable`);
  if (count("skipped")) parts.push(`${count("skipped")} skipped`);
  return parts.join(" · ");
}
