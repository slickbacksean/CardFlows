/**
 * Remote kill switches (Policy Reviewer, Oct 20): Live Scan and Grading can be turned off
 * server-side without an app update. Server env `CARD_FLOW_LIVESTREAM_ENABLED` (default on)
 * and `CARD_FLOW_GRADING_ENABLED` (default off). Changing them on Railway needs a
 * redeploy/restart; apps pick it up on the next /v1/status poll (STATUS_POLL_MS) or the next
 * feature call. Exposed on GET /v1/status as `features.livestream` and `features.grading`;
 * feature routes answer 503 `feature_disabled` while off.
 */
export const FEATURE_DISABLED_CODE = "feature_disabled";
/** Set on kill-switch 503s so ops metrics skip them (not an outage). */
export const FEATURE_DISABLED_HEADER = "x-cardflow-feature-disabled";
export const LIVESTREAM_DISABLED_COPY = "Live Scan is temporarily unavailable.";
export const GRADING_DISABLED_COPY = "Card grading is temporarily unavailable.";

export interface RemoteFeatureFlags {
  livestream: boolean;
  grading: boolean;
}

/** Default on. Only an explicit off value (0 / false / off / no) disables Live Scan. */
export function livestreamEnabledFromEnv(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) return true;
  return !["0", "false", "off", "no"].includes(value);
}

/** Default off. Only an explicit on value (1 / true / on / yes) enables grading. */
export function gradingEnabledFromEnv(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) return false;
  return ["1", "true", "on", "yes"].includes(value);
}

/** Older servers send no `features`: treat as on. */
export function livestreamEnabledFromStatus(status: { features?: Partial<RemoteFeatureFlags> | null } | null | undefined): boolean {
  return status?.features?.livestream !== false;
}

/** Older servers send no `features.grading`: treat as off (safe default). */
export function gradingEnabledFromStatus(status: { features?: Partial<RemoteFeatureFlags> | null } | null | undefined): boolean {
  return status?.features?.grading === true;
}

export function featureDisabledBody(feature: keyof RemoteFeatureFlags) {
  return { ok: false, code: FEATURE_DISABLED_CODE, feature, error: LIVESTREAM_DISABLED_COPY, userFacing: true } as const;
}
