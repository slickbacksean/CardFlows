/**
 * Phone-side grade-tab resilience (P0-03). Retry after "unavailable" keeps
 * both photos, a second submit is ignored, and leaving mid-request does not
 * drop the stills. Retake reasons are shown as their own list, then cleared
 * on retry or a new photo. Copy stays "Pre-grade estimate" — never AI or a
 * grading company.
 */
import { PREGRADE_UNAVAILABLE_MESSAGE, type PhotoPregradeSuccess } from "./photo-pregrade";
import { pregradeCopyViolations } from "./pregrade-copy";

export type GradeFlowStep = "guidelines" | "finder" | "capture" | "crop" | "scoring" | "result";
export type GradeFlowSide = "front" | "back";
export type GradeFlowResultKind = "score" | "unavailable";

export interface GradeFlowStill {
  uri: string;
  mimeType: string | null;
  cropUri: string | null;
  uploadId: string | null;
}

export interface GradeFlowState {
  step: GradeFlowStep;
  side: GradeFlowSide;
  front: GradeFlowStill | null;
  back: GradeFlowStill | null;
  detected: boolean;
  notice: string | null;
  warnings: string[];
  /** Hard-gate reasons for the side that must be replaced. Cleared on retry. */
  retakeReasons: string[];
  result: PhotoPregradeSuccess | null;
  resultKind: GradeFlowResultKind;
  unavailableMessage: string | null;
  scoring: boolean;
  checking: boolean;
  freezeUri: string | null;
}

export const GRADE_FLOW_RETRY_LABEL = "Retry" as const;
export const GRADE_FLOW_UNAVAILABLE_BODY = "The grader is unavailable. No score." as const;
export const GRADE_FLOW_RETAKE_HEADING = "Retake this photo" as const;

export function emptyGradeFlowState(): GradeFlowState {
  return {
    step: "guidelines",
    side: "front",
    front: null,
    back: null,
    detected: false,
    notice: null,
    warnings: [],
    retakeReasons: [],
    result: null,
    resultKind: "unavailable",
    unavailableMessage: null,
    scoring: false,
    checking: false,
    freezeUri: null,
  };
}

export function gradeFlowHasBothPhotos(state: GradeFlowState): boolean {
  return Boolean(state.front?.uri && state.back?.uri);
}

export function canBeginGradeSubmit(state: GradeFlowState): boolean {
  return !state.scoring && !state.checking && gradeFlowHasBothPhotos(state);
}

export function beginGradeSubmit(state: GradeFlowState): GradeFlowState | null {
  if (!canBeginGradeSubmit(state)) return null;
  return {
    ...state,
    scoring: true,
    step: "scoring",
    notice: null,
    retakeReasons: [],
    unavailableMessage: null,
    result: null,
  };
}

/** Retry after a network / unavailable answer. Same stills, no camera. */
export function retryUnavailable(state: GradeFlowState): GradeFlowState | null {
  if (state.step !== "result" || state.resultKind !== "unavailable") return null;
  if (!gradeFlowHasBothPhotos(state)) return null;
  return beginGradeSubmit({
    ...state,
    unavailableMessage: null,
    retakeReasons: [],
    notice: null,
    result: null,
  });
}

export function applyUnavailableResult(state: GradeFlowState, message: string): GradeFlowState {
  return {
    ...state,
    scoring: false,
    checking: false,
    step: "result",
    result: null,
    resultKind: "unavailable",
    unavailableMessage: message || PREGRADE_UNAVAILABLE_MESSAGE,
    freezeUri: null,
  };
}

export function applyScoreResult(state: GradeFlowState, result: PhotoPregradeSuccess): GradeFlowState {
  return {
    ...state,
    scoring: false,
    checking: false,
    step: "result",
    result,
    resultKind: "score",
    unavailableMessage: null,
    retakeReasons: [],
    notice: null,
    freezeUri: null,
  };
}

/**
 * Keep both original stills. Only the failed side drops its crop so that
 * side can be replaced. The good side is left alone.
 */
export function applyRetakeResult(
  state: GradeFlowState,
  side: GradeFlowSide,
  reasons: readonly string[],
): GradeFlowState {
  const dropCrop = (still: GradeFlowStill | null): GradeFlowStill | null =>
    still ? { ...still, cropUri: null } : still;
  return {
    ...state,
    scoring: false,
    checking: false,
    step: "crop",
    side,
    detected: false,
    warnings: [],
    retakeReasons: reasons.filter((reason) => reason.trim().length > 0),
    notice: null,
    result: null,
    resultKind: "unavailable",
    unavailableMessage: null,
    front: side === "front" ? dropCrop(state.front) : state.front,
    back: side === "back" ? dropCrop(state.back) : state.back,
    freezeUri: null,
  };
}

export function clearRetakeReasons(state: GradeFlowState): GradeFlowState {
  if (state.retakeReasons.length === 0 && state.notice == null) return state;
  return { ...state, retakeReasons: [], notice: null };
}

/** Snapshot used when the screen unmounts mid-request. Photos stay. */
export function persistGradeFlowOnLeave(state: GradeFlowState): GradeFlowState {
  return {
    ...state,
    freezeUri: null,
  };
}

export function formatRetakeReasons(reasons: readonly string[]): string {
  return reasons.map((reason) => reason.trim()).filter(Boolean).join(" · ");
}

export function retakeSideCopy(side: GradeFlowSide, reasons: readonly string[]): string {
  const detail = formatRetakeReasons(reasons);
  const which = side === "back" ? "back" : "front";
  return detail ? `Retake the ${which} photo: ${detail}.` : `Retake the ${which} photo.`;
}

export function gradeFlowCopyViolations(text: string): string[] {
  return pregradeCopyViolations(text);
}

export type GradeFlowListener = (state: GradeFlowState) => void;

export interface GradeFlowSession {
  getState(): GradeFlowState;
  replace(next: GradeFlowState): GradeFlowState;
  beginSubmit(): GradeFlowState | null;
  retryUnavailable(): GradeFlowState | null;
  applyUnavailable(message: string): GradeFlowState;
  applyScore(result: PhotoPregradeSuccess): GradeFlowState;
  applyRetake(side: GradeFlowSide, reasons: readonly string[]): GradeFlowState;
  persistOnLeave(): GradeFlowState;
  reset(): GradeFlowState;
  isSubmitLocked(): boolean;
  subscribe(listener: GradeFlowListener): () => void;
}

/**
 * In-memory session: one in-flight submit, photos survive leave/unmount.
 * Tests construct their own; the app holds one singleton.
 */
export function createGradeFlowSession(initial?: GradeFlowState): GradeFlowSession {
  let state = initial ?? emptyGradeFlowState();
  let submitLock = false;
  const listeners = new Set<GradeFlowListener>();

  function commit(next: GradeFlowState): GradeFlowState {
    state = next;
    if (!next.scoring) submitLock = false;
    for (const listener of listeners) listener(state);
    return state;
  }

  function startSubmit(next: GradeFlowState | null): GradeFlowState | null {
    if (submitLock || !next) return null;
    submitLock = true;
    return commit(next);
  }

  return {
    getState() {
      return state;
    },
    replace(next) {
      return commit(next);
    },
    beginSubmit() {
      return startSubmit(beginGradeSubmit(state));
    },
    retryUnavailable() {
      return startSubmit(retryUnavailable(state));
    },
    applyUnavailable(message) {
      return commit(applyUnavailableResult(state, message));
    },
    applyScore(result) {
      return commit(applyScoreResult(state, result));
    },
    applyRetake(side, reasons) {
      return commit(applyRetakeResult(state, side, reasons));
    },
    persistOnLeave() {
      return commit(persistGradeFlowOnLeave(state));
    },
    reset() {
      submitLock = false;
      return commit(emptyGradeFlowState());
    },
    isSubmitLocked() {
      return submitLock;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
