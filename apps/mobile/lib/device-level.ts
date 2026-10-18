import {
  GRADE_STEADY_WINDOW,
  gradeLevelHysteresis,
  gradeLevelStateHeld,
  gradeMotionSteady,
  tiltFromGravity,
  tiltFromRotation,
  type GradeLevelState,
  type MotionSample,
} from "@cardflow/shared";
import { requireOptionalNativeModule } from "expo";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

/**
 * Phone tilt for the Grade camera guide, from expo-sensors DeviceMotion.
 *
 * Feature-detected: expo-sensors' DeviceMotion calls requireNativeModule at
 * import time and throws if the native module isn't in this build (an older
 * dev client). So we check for the native module first and only then require
 * the JS package. Without it, `available` is false and the guide falls back
 * to the static frame. Expo Go ships the module.
 */

export interface DeviceLevel {
  available: boolean;
  pitchDeg: number | null;
  rollDeg: number | null;
  tiltDeg: number | null;
  level: GradeLevelState;
  /**
   * null until the motion window is full; true when the gyro and accelerometer
   * variance over the last ~0.7 s stay under the thresholds (gradeMotionSteady).
   */
  steady: boolean | null;
  /** Motion permission (Mobile Tech Lead review 7): "denied" gets its own hint; auto-capture is manual then. */
  permission: "granted" | "denied" | "unknown";
}

const UNAVAILABLE: DeviceLevel = {
  available: false,
  pitchDeg: null,
  rollDeg: null,
  tiltDeg: null,
  level: "unknown",
  steady: null,
  permission: "unknown",
};

const DENIED: DeviceLevel = { ...UNAVAILABLE, permission: "denied" };

type DeviceMotionModule = typeof import("expo-sensors").DeviceMotion;

let cachedMotion: DeviceMotionModule | null | undefined;

/** The DeviceMotion API when its native module is in this build, else null. */
export function loadDeviceMotion(): DeviceMotionModule | null {
  if (cachedMotion !== undefined) return cachedMotion;
  cachedMotion = null;
  if (Platform.OS !== "ios" && Platform.OS !== "android") return cachedMotion;
  try {
    if (!requireOptionalNativeModule("ExponentDeviceMotion")) return cachedMotion;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sensors = require("expo-sensors") as typeof import("expo-sensors");
    cachedMotion = sensors.DeviceMotion ?? null;
  } catch {
    cachedMotion = null;
  }
  return cachedMotion;
}

const UPDATE_MS = 100;
/** Low-pass weight for each new sample (0..1). */
const SMOOTHING = 0.35;

export function useDeviceLevel(enabled: boolean): DeviceLevel {
  const [state, setState] = useState<DeviceLevel>(UNAVAILABLE);

  useEffect(() => {
    if (!enabled) return;
    const motion = loadDeviceMotion();
    if (!motion) return; // state stays UNAVAILABLE
    let cancelled = false;
    let subscription: { remove: () => void } | null = null;
    let pitch: number | null = null;
    let roll: number | null = null;
    let tilt: number | null = null;
    const window: MotionSample[] = [];
    // UX review P0-2: enter level at ≤ 2.0°, leave above 2.5°.
    let levelHeld = false;

    void (async () => {
      try {
        const available = await motion.isAvailableAsync();
        if (cancelled || !available) {
          if (!cancelled) setState(UNAVAILABLE);
          return;
        }
        // Ask for Motion only here, when the Grade camera opens (never at launch).
        let permission = await motion.getPermissionsAsync().catch(() => null);
        if (permission && !permission.granted && permission.canAskAgain) {
          permission = await motion.requestPermissionsAsync().catch(() => null);
        }
        if (cancelled) return;
        if (permission && !permission.granted) {
          setState(DENIED);
          return;
        }
        motion.setUpdateInterval(UPDATE_MS);
        subscription = motion.addListener((m) => {
          const reading =
            (m.rotation ? tiltFromRotation(m.rotation.beta, m.rotation.gamma) : null) ??
            (m.accelerationIncludingGravity
              ? tiltFromGravity(
                  m.accelerationIncludingGravity.x,
                  m.accelerationIncludingGravity.y,
                  m.accelerationIncludingGravity.z,
                )
              : null);
          if (!reading) return;
          const blend = (prev: number | null, next: number) =>
            prev == null ? next : prev + (next - prev) * SMOOTHING;
          pitch = blend(pitch, reading.pitchDeg);
          roll = blend(roll, reading.rollDeg);
          tilt = blend(tilt, reading.tiltDeg);
          const rr = m.rotationRate;
          const acc = m.acceleration;
          window.push({
            gyro: rr ? Math.hypot(rr.alpha, rr.beta, rr.gamma) : null,
            accel: acc ? Math.hypot(acc.x, acc.y, acc.z) : null,
          });
          if (window.length > GRADE_STEADY_WINDOW) window.shift();
          levelHeld = gradeLevelHysteresis(levelHeld, tilt);
          setState({
            available: true,
            pitchDeg: pitch,
            rollDeg: roll,
            tiltDeg: tilt,
            level: gradeLevelStateHeld(levelHeld, tilt),
            steady: gradeMotionSteady(window),
            permission: "granted",
          });
        });
      } catch {
        if (!cancelled) setState(UNAVAILABLE);
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
      setState(UNAVAILABLE);
    };
  }, [enabled]);

  return enabled ? state : UNAVAILABLE;
}
