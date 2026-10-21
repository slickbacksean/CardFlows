/**
 * Remote kill switches (Policy Reviewer, Oct 20): Live Scan can be turned off server-side
 * without an app update if Whatnot or Apple objects. Server env `CARD_FLOW_LIVESTREAM_ENABLED`
 * (default on). Exposed on GET /v1/status as `features.livestream`; livestream routes answer
 * 503 `feature_disabled` while off.
 */
export const FEATURE_DISABLED_CODE = "feature_disabled";
export const LIVESTREAM_DISABLED_COPY = "Live Scan is temporarily unavailable.";

export interface RemoteFeatureFlags {
  livestream: boolean;
}

/** Default on. Only an explicit off value (0 / false / off / no) disables Live Scan. */
export function livestreamEnabledFromEnv(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) return true;
  return !["0", "false", "off", "no"].includes(value);
}

/** Older servers send no `features`: treat as on. */
export function livestreamEnabledFromStatus(status: { features?: Partial<RemoteFeatureFlags> | null } | null | undefined): boolean {
  return status?.features?.livestream !== false;
}

export function featureDisabledBody(feature: keyof RemoteFeatureFlags) {
  return { ok: false, code: FEATURE_DISABLED_CODE, feature, error: LIVESTREAM_DISABLED_COPY, userFacing: true } as const;
}
