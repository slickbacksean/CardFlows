/** Server env. Not a Settings toggle. Required before loading gitignored YOLO weights. */
export const ULTRALYTICS_AGPL_ACCEPTED_FLAG = "ultralytics_agpl_accepted" as const;

export const ULTRALYTICS_AGPL_REQUIRED_MESSAGE =
  "Accept Ultralytics AGPL (CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true) before loading YOLO weights." as const;

type Env = Record<string, string | undefined>;

/**
 * Ultralytics YOLO is AGPL. CardFlow never ships `.onnx` / `.pt` in git.
 * Missing this flag → full-frame stub / unidentified live video.
 */
export function ultralyticsAgplAccepted(env: Env = process.env): boolean {
  return env.CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED?.trim().toLowerCase() === "true";
}
