import {
  AGE_GATE_COPY,
  CAMERA_ALLOW_LABEL,
  CAMERA_DENIED_BODY,
  CAMERA_DENIED_TITLE,
  CAMERA_PREPROMPT_BODY,
  CAMERA_PREPROMPT_TITLE,
  PHOTO_PICKER_UNAVAILABLE_COPY,
  actionErrorMessage,
  classifyLoadError,
  SCAN_SESSION_ENDED_COPY,
} from "@cardflow/shared";
import { isOfflineScanError, queueOfflineScan } from "@/lib/scan-queue";
import { trackScanStarted } from "@/lib/product-events";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useRef, useState, type RefObject } from "react";
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
import { PermissionGate } from "@/components/ui/permission-gate";
import { InlineError } from "@/components/ui/screen-state";
import { createScan } from "@/lib/api";
import { ensureAccountAgeConfirmed } from "@/lib/age-confirmation";
import { requireAccount, useAccountOrLeave } from "@/lib/signup-prompt";
import { getMockScenario } from "@/lib/mock-scenario";
import { prepareScanStill, rememberScanCapture } from "@/lib/scan-capture";
import { launchSystemImagePicker } from "@/lib/system-photo-picker";
import { colors, space } from "@/lib/theme";

const IS_NATIVE = Platform.OS === "ios" || Platform.OS === "android";
const STILL_PHOTO = { quality: 1, imageType: "jpg" as const };

export default function CaptureScreen() {
  const router = useRouter();
  // Browse-only guests (Sean, Oct 17): no camera for a guest; the sign-up prompt instead.
  useAccountOrLeave();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [devForceDenied, setDevForceDenied] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraMountFailed, setCameraMountFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [flashlightOn, setFlashlightOn] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showCameraPreprompt, setShowCameraPreprompt] = useState(false);

  const isDenied =
    devForceDenied || (IS_NATIVE && permission?.status === "denied");
  const permissionLoading = IS_NATIVE && !devForceDenied && permission == null;
  const showLivePreview =
    IS_NATIVE && !isDenied && permission?.granted === true && !cameraMountFailed;
  const waitingForCamera = showLivePreview && !cameraReady;
  const shutterDisabled = isSubmitting || permissionLoading || waitingForCamera;
  const cameraLive = showLivePreview;
  const [cameraLiveSeen, setCameraLiveSeen] = useState(cameraLive);
  if (cameraLiveSeen !== cameraLive) {
    setCameraLiveSeen(cameraLive);
    if (!cameraLive) {
      setCameraReady(false);
      setCameraMountFailed(false);
    }
  }

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
    size?: { width?: number; height?: number },
  ) {
    // Browse-only guests (Sean, Oct 17): sign up before any scan.
    if (!requireAccount()) return;
    // Sean (Oct 21): CardSight consent is part of the Terms accepted at sign-up (no separate prompt).
    // Accounts still confirm 18+ first (testers and existing accounts once; new accounts did at sign-up).
    if (imageUri) await ensureAccountAgeConfirmed();
    const startedAt = Date.now();
    let uploadUri = imageUri;
    let uploadMime = imageMimeType ?? null;
    if (imageUri) {
      const prepared = await prepareScanStill(imageUri, imageMimeType, size);
      if ("error" in prepared) throw new Error(prepared.error);
      uploadUri = prepared.still.uri;
      uploadMime = prepared.still.mimeType;
    }
    let result: Awaited<ReturnType<typeof createScan>>;
    try {
      result = await createScan({
        captureMethod,
        scenario: uploadUri || !__DEV__ ? undefined : getMockScenario(),
        imageUri: uploadUri,
        imageMimeType: uploadMime,
      });
    } catch (caught) {
      // P1-10: offline → keep the still and match it when the phone is back online.
      if (
        uploadUri &&
        isOfflineScanError(caught) &&
        queueOfflineScan({ imageUri: uploadUri, mimeType: uploadMime ?? "image/jpeg", captureMethod })
      ) {
        router.replace("/(tabs)/collection");
        return;
      }
      throw caught;
    }
    if (uploadUri) rememberScanCapture(result.scan.scanId, uploadUri);
    trackScanStarted(result.scan.scanId, captureMethod, startedAt);
    router.push(`/scan/${result.scan.scanId}`);
  }

  async function confirmCameraPreprompt() {
    setShowCameraPreprompt(false);
    setError(null);
    const result = await requestPermission();
    if (!result.granted) return;
  }

  function onSearchByName() {
    if (isSubmitting) return;
    router.replace("/(tabs)/shop");
  }

  async function onShutter() {
    if (shutterDisabled) return;
    if (IS_NATIVE && !devForceDenied && permission && !permission.granted) {
      if (permission.canAskAgain) {
        setShowCameraPreprompt(true);
        return;
      }
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      if (showLivePreview) {
        try {
          const imageUri = await takeStillPhoto(cameraRef.current);
          if (!imageUri) {
            setError("Couldn't take a photo. Try again.");
            return;
          }
          await postScan("camera_photo", imageUri, "image/jpeg");
          return;
        } catch (caught) {
          setError(scanFailureMessage(caught, "Couldn't take a photo. Try again."));
          return;
        }
      }
      if (IS_NATIVE && permission?.granted === true && !cameraMountFailed) {
        setError("Couldn't take a photo. Try again.");
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
    setShowCameraPreprompt(false);
    setError(null);
    try {
      const asset = await launchSystemImagePicker({ quality: 1 });
      if (!asset) return;
      const uri = asset.uri ?? null;
      if (!uri) {
        setError("Couldn't read that photo. Try another.");
        return;
      }
      setIsSubmitting(true);
      await postScan("manual_scan", uri, asset.mimeType ?? null, {
        width: asset.width,
        height: asset.height,
      });
    } catch (caught) {
      setError(actionErrorMessage(caught, PHOTO_PICKER_UNAVAILABLE_COPY));
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

  const title = isDenied || showCameraPreprompt ? "Capture" : null;

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
        {!isDenied && !showCameraPreprompt ? (
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
        <PermissionGate
          body={CAMERA_DENIED_BODY}
          disabled={isSubmitting}
          onChoosePhoto={() => void onChooseFromLibrary()}
          onOpenSettings={() => void openSystemSettings()}
          onSearchByName={onSearchByName}
          title={CAMERA_DENIED_TITLE}
        />
      ) : showCameraPreprompt ? (
        <PermissionGate
          body={CAMERA_PREPROMPT_BODY}
          continueLabel={CAMERA_ALLOW_LABEL}
          disabled={isSubmitting}
          onChoosePhoto={() => void onChooseFromLibrary()}
          onContinue={() => void confirmCameraPreprompt()}
          onSearchByName={onSearchByName}
          title={CAMERA_PREPROMPT_TITLE}
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

      {error ? (
        <View style={styles.errorWrap}>
          <InlineError message={error} />
        </View>
      ) : null}

      {helpOpen ? (
        <View style={styles.helpCard}>
          <Text style={styles.helpTitle}>Still photo only</Text>
          <Text style={styles.helpBody}>
            Fill the frame with one or more English raw singles (up to nine). PokeSniper does not identify
            while you hold the camera. Scan does not create inventory.
          </Text>
        </View>
      ) : null}

      {__DEV__ ? (
        <View style={styles.devPanel}>
          <DevScenarioPanel />
          <Pressable
            accessibilityLabel={devForceDenied ? "Developer: back to camera" : "Developer: preview camera access off"}
            accessibilityRole="button"
            onPress={() => {
              setDevForceDenied((current) => !current);
              setShowCameraPreprompt(false);
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

      {!isDenied && !showCameraPreprompt ? (
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
  // UX review P1-4: accounts, not invite codes, now.
  if (classifyLoadError(caught) === "auth" || (caught instanceof Error && caught.message === "Unauthorized")) {
    return SCAN_SESSION_ENDED_COPY;
  }
  // P5: shared offline / can't-reach / server wording.
  return actionErrorMessage(caught, fallback);
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
        Take a still photo of one or more English raw singles to identify them.
      </Text>
      <Text style={styles.copy}>{AGE_GATE_COPY.captureTip}</Text>
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
  errorWrap: { paddingHorizontal: space.lg, paddingBottom: space.sm },
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
