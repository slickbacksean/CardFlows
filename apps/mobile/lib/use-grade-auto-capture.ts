import { GRADE_AUTO_CAPTURE_INITIAL, gradeAutoCaptureStep } from "@cardflow/shared";
import { useEffect, useRef, useState } from "react";

/**
 * P1-15: fires `onFire` once the phone has been level (≤ 2°) and still for
 * 0.5 s. Re-evaluated on every sensor tick (`tick` changes ~every 100 ms).
 * The manual shutter is separate and always works.
 */
export function useGradeAutoCapture(input: {
  tick: unknown;
  autoCaptureReady: boolean;
  enabled: boolean;
  busy: boolean;
  onFire: () => void;
}): { holdProgress: number } {
  const stateRef = useRef(GRADE_AUTO_CAPTURE_INITIAL);
  const fireRef = useRef(input.onFire);
  const [holdProgress, setHoldProgress] = useState(0);
  useEffect(() => {
    fireRef.current = input.onFire;
  });
  const { tick, autoCaptureReady, enabled, busy } = input;
  useEffect(() => {
    const step = gradeAutoCaptureStep(stateRef.current, { autoCaptureReady, enabled, busy, nowMs: Date.now() });
    stateRef.current = step.state;
    setHoldProgress(step.holdProgress);
    if (step.fire) fireRef.current();
  }, [tick, autoCaptureReady, enabled, busy]);
  return { holdProgress };
}
