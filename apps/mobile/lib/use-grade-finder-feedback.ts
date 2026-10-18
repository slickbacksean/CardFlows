import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import type { GradeLevelState } from "@cardflow/shared";

/** UX review P1-5: follow the system Reduce Motion setting. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (!cancelled) setReduce(on);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);
  return reduce;
}

/**
 * UX review P1-7: with Auto off or unavailable, one light tap each time the phone
 * becomes level (the level state already has the 2.0/2.5° hysteresis). With Auto
 * on there's no level tap: the hold follows straight away and the capture has its own.
 */
export function useLevelHaptic(level: GradeLevelState, manualMode: boolean, capturing: boolean) {
  const wasLevel = useRef(false);
  useEffect(() => {
    const isLevel = level === "level";
    if (isLevel && !wasLevel.current && manualMode && !capturing) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    wasLevel.current = isLevel;
  }, [level, manualMode, capturing]);
}
