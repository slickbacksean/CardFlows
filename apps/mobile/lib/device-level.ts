import {
  GRADE_STEADY_MAX_DEG_PER_S,
  gradeLevelState,
  tiltFromGravity,
  tiltFromRotation,
  type GradeLevelState,
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
  /** null until enough samples; true when rotation rate stays low. */
  steady: boolean | null;
}

const UNAVAILABLE: DeviceLevel = {
  available: false,
  pitchDeg: null,
  rollDeg: null,
  tiltDeg: null,
  level: "unknown",
  steady: null,
};

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
    let rate: number | null = null;
    let samples = 0;

    void (async () => {
      try {
        const available = await motion.isAvailableAsync();
        if (cancelled || !available) {
          if (!cancelled) setState(UNAVAILABLE);
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
          if (rr) rate = blend(rate, Math.hypot(rr.alpha, rr.beta, rr.gamma));
          samples += 1;
          setState({
            available: true,
            pitchDeg: pitch,
            rollDeg: roll,
            tiltDeg: tilt,
            level: gradeLevelState(tilt),
            steady: rate == null || samples < 5 ? null : rate <= GRADE_STEADY_MAX_DEG_PER_S,
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
