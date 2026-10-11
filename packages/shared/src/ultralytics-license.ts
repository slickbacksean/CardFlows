/** Server env. Not a Settings toggle. Required before loading gitignored YOLO weights. */
export const ULTRALYTICS_AGPL_ACCEPTED_FLAG = "ultralytics_agpl_accepted" as const;

export const ULTRALYTICS_AGPL_REQUIRED_MESSAGE =
  "Accept Ultralytics AGPL (CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true) before loading YOLO weights." as const;

export const YOLO26N_ONDEVICE_FLAG = "yolo26n_ondevice" as const;

export const YOLO26N_ONDEVICE_ENV = "CARD_FLOW_YOLO26N_ONDEVICE" as const;

export const YOLO26N_ONDEVICE_PUBLIC_ENV = "EXPO_PUBLIC_CARD_FLOW_YOLO26N_ONDEVICE" as const;

/**
 * EAS / store profiles that must never package or enable Ultralytics YOLO26n.
 * Pre-ship testing uses a development client only.
 */
export const YOLO26N_SHIP_BLOCKED_PROFILES = [
  "production",
  "store",
  "app-store",
  "appstore",
] as const;

/**
 * TODO(ship): Replace YOLO26n (Ultralytics AGPL-3.0) with a non-AGPL detector,
 * or buy an Ultralytics Enterprise license, before any App Store / production ship.
 * This path is pre-ship testing only.
 */
export const YOLO26N_LICENSE_SHIP_TODO =
  "TODO(ship): Replace YOLO26n (Ultralytics AGPL-3.0) or buy an Ultralytics Enterprise license before App Store / production ship. Pre-ship testing only." as const;

type Env = Record<string, string | undefined>;

function envFlagTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

/**
 * Ultralytics YOLO is AGPL. CardFlow never ships `.onnx` / `.pt` in git.
 * Missing this flag → full-frame stub / unidentified live video.
 */
export function ultralyticsAgplAccepted(env: Env = process.env): boolean {
  return envFlagTrue(env.CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED);
}

/** Mobile extras may mirror the server flag via EXPO_PUBLIC_*. */
export function ultralyticsAgplAcceptedForClient(env: Env = process.env): boolean {
  return (
    ultralyticsAgplAccepted(env) ||
    envFlagTrue(env.EXPO_PUBLIC_CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED)
  );
}

export function isYolo26nShipBlockedProfile(
  profile: string | null | undefined,
): boolean {
  const normalized = profile?.trim().toLowerCase() ?? "";
  return (YOLO26N_SHIP_BLOCKED_PROFILES as readonly string[]).includes(normalized);
}

export function yolo26nOnDeviceRequested(env: Env = process.env): boolean {
  return (
    envFlagTrue(env[YOLO26N_ONDEVICE_ENV]) || envFlagTrue(env[YOLO26N_ONDEVICE_PUBLIC_ENV])
  );
}

export interface Yolo26nOnDeviceGateInput {
  env?: Env;
  easBuildProfile?: string | null;
}

/**
 * On-device YOLO26n is pre-ship only. Requires the existing AGPL accept flag
 * and an explicit YOLO26n opt-in. Production / App Store EAS profiles stay off
 * even if someone sets the opt-in env by mistake.
 */
export function yolo26nOnDeviceAllowed(input: Yolo26nOnDeviceGateInput = {}): boolean {
  const env = input.env ?? process.env;
  const profile = input.easBuildProfile ?? env.EAS_BUILD_PROFILE ?? null;
  if (isYolo26nShipBlockedProfile(profile)) return false;
  if (!ultralyticsAgplAcceptedForClient(env)) return false;
  return yolo26nOnDeviceRequested(env);
}
