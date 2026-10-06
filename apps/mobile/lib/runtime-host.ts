import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";

export function isExpoGoRuntime(): boolean {
  return (
    Constants.executionEnvironment === "storeClient" ||
    Constants.appOwnership === "expo"
  );
}

/**
 * Whether LAN `EXPO_PUBLIC_*` URLs should be used.
 * `expo-device` is compiled into Expo Go: false in the simulator, true on a phone.
 * `Constants.platform.ios.simulator` is not set in SDK 57, so a missing flag must not
 * count as a physical device.
 */
export function isPhysicalRuntime(): boolean {
  if (Platform.OS === "web") return false;
  return Device.isDevice === true;
}
