import { forbiddenAboutClaim } from "./about";
import type { MappingStatus } from "./types";

/** User-safe Confirm copy when identify cannot pick one English print. */
export const CONFIRM_COULD_NOT_CONFIRM_MESSAGE =
  "We couldn't confirm this card — search by English set and number";

export const CONFIRM_FAIL_SOFT_TITLE = "Couldn't confirm";

export const CONFIRM_COULD_NOT_IDENTIFY_TITLE = "Could not identify";

export const CONFIRM_AMBIGUOUS_TITLE = "Ambiguous — pick the print.";

export const CONFIRM_SEARCH_MANUALLY_LABEL = "Search manually";

export const CONFIRM_FRAMES = [
  "high",
  "ambiguous",
  "no-card",
  "timeout",
  "rate-limit",
  "no-match",
  "rejected",
] as const;

export type ConfirmFrame = (typeof CONFIRM_FRAMES)[number];

/** Frames that must offer Search manually so a bad still can still Confirm. */
export const CONFIRM_SEARCH_FRAMES = [
  "ambiguous",
  "no-card",
  "no-match",
  "timeout",
  "rate-limit",
] as const;

export type ConfirmSearchFrame = (typeof CONFIRM_SEARCH_FRAMES)[number];

export function isConfirmSearchFrame(frame: ConfirmFrame): frame is ConfirmSearchFrame {
  return (CONFIRM_SEARCH_FRAMES as readonly string[]).includes(frame);
}

export interface ConfirmScanView {
  recognitionOk: boolean;
  recognitionCode?: string | null;
  detectionCount: number;
  mappingStatus: MappingStatus | string;
  hasCanonicalCard: boolean;
  scenario?: string | null;
}

/**
 * Confirm screen frame. No box → no-card. No hash/catalog map → no-match.
 * Ambiguous keeps the picker. Missing/oversize stills are fail-soft, not a timeout.
 */
export function confirmFrameFromScan(scan: ConfirmScanView): ConfirmFrame {
  const code = scan.recognitionCode ?? "";
  if (!scan.recognitionOk) {
    if (code === "RATE_LIMITED" || scan.scenario === "rate-limit") return "rate-limit";
    if (code === "BAD_REQUEST") return scan.detectionCount === 0 ? "no-card" : "no-match";
    return "timeout";
  }
  if (scan.detectionCount === 0) return "no-card";
  if (scan.mappingStatus === "ambiguous") return "ambiguous";
  if (scan.mappingStatus === "matched" && scan.hasCanonicalCard) return "high";
  return "no-match";
}

export function confirmFailSoftTitle(frame: ConfirmFrame): string {
  if (frame === "ambiguous") return CONFIRM_AMBIGUOUS_TITLE;
  if (frame === "no-match") return CONFIRM_COULD_NOT_IDENTIFY_TITLE;
  if (frame === "timeout") return "Recognition timed out";
  if (frame === "rate-limit") return "Too many scans";
  return CONFIRM_FAIL_SOFT_TITLE;
}

export function confirmFailSoftBody(frame: ConfirmFrame): string {
  if (frame === "timeout") return "Retryable. Nothing was confirmed.";
  if (frame === "rate-limit") return "Wait and retry. CardFlow did not save this card.";
  return CONFIRM_COULD_NOT_CONFIRM_MESSAGE;
}

export function forbiddenConfirmClaim(copy: string): string | null {
  return forbiddenAboutClaim(copy);
}
