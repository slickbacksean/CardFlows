import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DevScenarioPanel } from "@/components/ui/dev-scenario-panel";
import { PrimaryButton } from "@/components/ui/primary-button";
import { createScan } from "@/lib/api";
import { getMockScenario } from "@/lib/mock-scenario";
import { rememberScanCapture } from "@/lib/scan-capture";
import { colors, space } from "@/lib/theme";

const IS_NATIVE = Platform.OS === "ios" || Platform.OS === "android";
const STILL_PHOTO = { quality: 0.8, imageType: "jpg" as const };

export default function CaptureScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [devForceDenied, setDevForceDenied] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraMountFailed, setCameraMountFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [flashlightOn, setFlashlightOn] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const isDenied =
    devForceDenied || (IS_NATIVE && permission?.status === "denied");
  const permissionPending =
    IS_NATIVE &&
    !devForceDenied &&
    (permission == null || permission.status === "undetermined");
  const showLivePreview =
    IS_NATIVE && !isDenied && permission?.granted === true && !cameraMountFailed;
  const waitingForCamera = showLivePreview && !cameraReady;
  const shutterDisabled = isSubmitting || permissionPending || waitingForCamera;
  const cameraLive = showLivePreview;
  const [cameraLiveSeen, setCameraLiveSeen] = useState(cameraLive);
  if (cameraLiveSeen !== cameraLive) {
    setCameraLiveSeen(cameraLive);
    if (!cameraLive) {
      setCameraReady(false);
      setCameraMountFailed(false);
    }
  }

  useEffect(() => {
    if (!IS_NATIVE || devForceDenied) return;
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [devForceDenied, permission, requestPermission]);

  function leaveCapture() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/collection");
  }

  async function postScan(
    captureMethod: "camera_photo" | "manual_scan",
    imageUri: string | null,
    imageMimeType?: string | null,
  ) {
    const result = await createScan({
      captureMethod,
      scenario: imageUri || !__DEV__ ? undefined : getMockScenario(),
      imageUri,
      imageMimeType,
    });
    if (imageUri) rememberScanCapture(result.scan.scanId, imageUri);
    router.push(`/scan/${result.scan.scanId}`);
  }

  async function onShutter() {
    if (shutterDisabled) return;
    setIsSubmitting(true);
    setError(null);
    try {
      if (showLivePreview) {
        try {
          const imageUri = await takeStillPhoto(cameraRef.current);
          if (!imageUri) {
            setError("Could not take a photo. Try again.");
            return;
          }
          await postScan("camera_photo", imageUri, "image/jpeg");
          return;
        } catch (caught) {
          setError(scanFailureMessage(caught, "Could not take a photo. Try again."));
          return;
        }
      }
      if (IS_NATIVE && permission?.granted === true && !cameraMountFailed) {
        setError("Could not take a photo. Try again.");
        return;
      }
      if (Platform.OS === "web") {
        setError("Take a photo in the iOS or Android app, or choose from your library.");
        return;
      }
      await postScan("camera_photo", null);
    } catch (caught) {
      setError(scanFailureMessage(caught, "Scan failed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onChooseFromLibrary() {
    if (isSubmitting) return;
    setHelpOpen(false);
    setError(null);
    try {
      if (IS_NATIVE) {
        const media = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!media.granted) {
          setError(
            "Photo library access is off. Enable it in system Settings, or take a still photo.",
          );
          return;
        }
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        allowsMultipleSelection: false,
        quality: 0.8,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const uri = asset?.uri ?? null;
      if (!uri) {
        setError("Could not read that photo. Try another.");
        return;
      }
      setIsSubmitting(true);
      await postScan("manual_scan", uri, asset?.mimeType ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the photo library.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function openSystemSettings() {
    try {
      await Linking.openSettings();
    } catch {
      setError("Open system Settings on your device to enable the camera.");
    }
  }

  const title = isDenied ? "Capture" : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="Cancel"
          accessibilityRole="button"
          hitSlop={12}
          onPress={leaveCapture}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="close" size={28} />
        </Pressable>
        {title ? (
          <Text numberOfLines={1} style={styles.topTitle}>
            {title}
          </Text>
        ) : (
          <View style={styles.topTitleSpacer} />
        )}
        {!isDenied ? (
          <Pressable
            accessibilityLabel="Flashlight"
            accessibilityRole="button"
            accessibilityState={{ selected: flashlightOn }}
            hitSlop={12}
            onPress={() => setFlashlightOn((value) => !value)}
            style={styles.iconButton}
          >
            <Ionicons
              color={flashlightOn ? colors.accent : colors.text}
              name={flashlightOn ? "flash" : "flash-outline"}
              size={24}
            />
          </Pressable>
        ) : (
          <View style={styles.iconButton} />
        )}
      </View>

      {isDenied ? (
        <PermissionDeniedSurface
          disabled={isSubmitting}
          onChoosePhoto={() => void onChooseFromLibrary()}
          onOpenSettings={() => void openSystemSettings()}
        />
      ) : (
        <CameraSurface
          cameraRef={cameraRef}
          enableLivePreview={showLivePreview}
          flashlightOn={flashlightOn}
          onCameraReady={() => setCameraReady(true)}
          onMountError={() => setCameraMountFailed(true)}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {helpOpen ? (
        <View style={styles.helpCard}>
          <Text style={styles.helpTitle}>Still photo only</Text>
          <Text style={styles.helpBody}>
            Fill the frame with one English raw single. CardFlow does not identify
            while you hold the camera. Scan does not create inventory.
          </Text>
        </View>
      ) : null}

      {__DEV__ ? (
        <View style={styles.devPanel}>
          <DevScenarioPanel />
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setDevForceDenied((current) => !current);
              setHelpOpen(false);
              setError(null);
              setFlashlightOn(false);
            }}
            style={styles.devToggle}
          >
            <Text style={styles.devToggleLabel}>
              {devForceDenied ? "DEV  Back to camera" : "DEV  Preview camera access off"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {!isDenied ? (
        <View style={styles.toolbar}>
          <Pressable
            accessibilityLabel="Choose photo"
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={() => void onChooseFromLibrary()}
            style={[styles.toolbarSide, isSubmitting && styles.disabled]}
          >
            <Ionicons color={colors.text} name="images-outline" size={28} />
          </Pressable>
          <Pressable
            accessibilityLabel="Take photo"
            accessibilityRole="button"
            accessibilityState={{ disabled: shutterDisabled }}
            disabled={shutterDisabled}
            onPress={() => void onShutter()}
            style={[styles.shutterOuter, shutterDisabled && styles.disabled]}
          >
            {isSubmitting || waitingForCamera ? (
              <ActivityIndicator color={colors.ctaText} />
            ) : (
              <View style={styles.shutterInner} />
            )}
          </Pressable>
          <Pressable
            accessibilityLabel="Help"
            accessibilityRole="button"
            accessibilityState={{ selected: helpOpen }}
            onPress={() => setHelpOpen((value) => !value)}
            style={styles.toolbarSide}
          >
            <Ionicons
              color={helpOpen ? colors.accent : colors.text}
              name={helpOpen ? "help-circle" : "help-circle-outline"}
              size={28}
            />
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function scanFailureMessage(caught: unknown, fallback: string): string {
  const message = caught instanceof Error ? caught.message : fallback;
  if (message === "Unauthorized") {
    return "Invite session expired. Open Settings, enter your invite code, then take the photo again.";
  }
  return message;
}

async function takeStillPhoto(camera: CameraView | null): Promise<string | null> {
  if (!camera) return null;
  const photo = await camera.takePictureAsync(STILL_PHOTO);
  return photo?.uri ?? null;
}

interface CameraSurfaceProps {
  cameraRef: RefObject<CameraView | null>;
  enableLivePreview: boolean;
  flashlightOn: boolean;
  onCameraReady: () => void;
  onMountError: () => void;
}

function CameraSurface({
  cameraRef,
  enableLivePreview,
  flashlightOn,
  onCameraReady,
  onMountError,
}: CameraSurfaceProps) {
  const { width, height } = useWindowDimensions();
  const maxFrameHeight = Math.max(160, height * 0.38);
  const frameWidth = Math.min(width * 0.62, 240, maxFrameHeight * (2.5 / 3.5));
  const frameHeight = frameWidth * (3.5 / 2.5);

  return (
    <View style={styles.viewfinder}>
      <View
        style={[
          styles.viewfinderStage,
          !enableLivePreview && styles.viewfinderStageMock,
        ]}
      >
        {enableLivePreview ? (
          <CameraView
            ref={cameraRef}
            enableTorch={flashlightOn}
            facing="back"
            mode="picture"
            mute
            onCameraReady={onCameraReady}
            onMountError={onMountError}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View pointerEvents="none" style={styles.frameOverlay}>
          <View style={styles.dimBand} />
          <View style={styles.frameRow}>
            <View style={styles.dimBand} />
            <View
              style={[
                styles.frame,
                {
                  width: frameWidth,
                  height: frameHeight,
                  backgroundColor: enableLivePreview
                    ? "transparent"
                    : flashlightOn
                      ? "#1A1E14"
                      : "#0B0E11",
                },
              ]}
            >
              {enableLivePreview ? null : (
                <Text style={styles.frameHint}>still image only</Text>
              )}
            </View>
            <View style={styles.dimBand} />
          </View>
          <View style={styles.dimBand} />
        </View>
      </View>
      <Text style={styles.copy}>
        Take a still photo of one English raw single to identify it.
      </Text>
    </View>
  );
}

interface PermissionDeniedSurfaceProps {
  disabled: boolean;
  onOpenSettings: () => void;
  onChoosePhoto: () => void;
}

function PermissionDeniedSurface({
  disabled,
  onOpenSettings,
  onChoosePhoto,
}: PermissionDeniedSurfaceProps) {
  return (
    <View style={styles.panelBody}>
      <Text style={styles.title}>Camera access is off.</Text>
      <Text style={styles.body}>
        Enable it in system Settings, or pick a photo from the library.
      </Text>
      <PrimaryButton
        disabled={disabled}
        label="Open system Settings"
        onPress={onOpenSettings}
        tone="muted"
      />
      <PrimaryButton disabled={disabled} label="Choose photo" onPress={onChoosePhoto} />
    </View>
  );
}

const DIM = "rgba(0,0,0,0.55)";

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#07090B" },
  topBar: {
    paddingHorizontal: space.md,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
  },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  topTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  topTitleSpacer: { flex: 1 },
  viewfinder: { flex: 1, minHeight: 0 },
  viewfinderStage: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  viewfinderStageMock: {
    backgroundColor: DIM,
  },
  frameOverlay: {
    ...StyleSheet.absoluteFill,
  },
  dimBand: {
    flex: 1,
    backgroundColor: DIM,
  },
  frameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  frame: {
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  frameHint: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  copy: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
    fontWeight: "600",
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: DIM,
  },
  panelBody: {
    flex: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    gap: space.md,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  error: {
    color: colors.danger,
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  helpCard: {
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: space.md,
    gap: space.xs,
  },
  helpTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  helpBody: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  devPanel: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.sm },
  devToggle: {
    alignSelf: "flex-start",
    paddingVertical: 6,
  },
  devToggleLabel: { color: colors.accent, fontSize: 12, fontWeight: "700" },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  toolbarSide: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.5 },
  shutterOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.cta,
  },
});
