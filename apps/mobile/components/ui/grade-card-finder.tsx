import {
  CAMERA_ALLOW_LABEL,
  CAMERA_DENIED_TITLE,
  CHOOSE_A_PHOTO_LABEL,
  GRADE_CAMERA_PREPROMPT_BODY,
  GRADE_CAMERA_PREPROMPT_TITLE,
  OPEN_SETTINGS_LABEL,
  GRADE_GUIDE_COPY,
  GRADE_LEVEL_NEAR_DEG,
  GRADE_LEVEL_OK_DEG,
  gradeCaptureReadiness,
  type GradeCaptureReadiness,
} from "@cardflow/shared";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
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
import { PrimaryButton } from "@/components/ui/primary-button";
import {
  CARD_ASPECT_RATIO,
  largestPictureSize,
  stillFromCameraCapture,
  type PickedGradeStill,
} from "@/lib/grade-photos";
import { TAB_CURVE_RADIUS } from "@/components/ui/tab-bar-metrics";
import { useDeviceLevel, type DeviceLevel } from "@/lib/device-level";
import { colors, space } from "@/lib/theme";

const DIM = "rgba(0,0,0,0.55)";
/** Guide colors by level: green within 2°, amber up to 6°, red beyond. */
const GUIDE_COLORS = {
  good: "#5BD178",
  warn: "#F2B33D",
  bad: "#F06A5B",
  neutral: colors.accent,
} as const;
const IS_NATIVE = Platform.OS === "ios" || Platform.OS === "android";

interface GradeCardFinderProps {
  side: "front" | "back";
  detecting: boolean;
  freezeUri: string | null;
  notice?: string | null;
  onCaptured: (still: PickedGradeStill) => void;
  onLibrary: () => void;
  onBack: () => void;
}

export function GradeCardFinder({
  side,
  detecting,
  freezeUri,
  notice,
  onCaptured,
  onLibrary,
  onBack,
}: GradeCardFinderProps) {
  const cameraRef = useRef<CameraView>(null);
  const busyRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraMountFailed, setCameraMountFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const granted = permission?.granted === true;
  // Live camera is native-only, matching the Capture tab's gate.
  const showLivePreview = IS_NATIVE && granted && !cameraMountFailed;
  const [capturing, setCapturing] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);
  // The shutter waits until the largest picture size is resolved and passed to the
  // camera, so the first shot never uses the small default size.
  const [pictureSizeResolved, setPictureSizeResolved] = useState(false);
  const waitingForCamera = showLivePreview && (!cameraReady || !pictureSizeResolved);
  const shutterDisabled = detecting || waitingForCamera || capturing;
  const banner = error ?? notice ?? null;
  // Tilt guide: feature-detected DeviceMotion; falls back to the static frame.
  const level = useDeviceLevel(showLivePreview && !freezeUri);
  const readiness = gradeCaptureReadiness({
    sensorAvailable: level.available,
    level: level.level,
    steady: level.steady,
    cardInFrame: null,
  });
  const guideColor = GUIDE_COLORS[readiness.tone];

  async function onShutter() {
    if (busyRef.current || shutterDisabled || !showLivePreview) return;
    busyRef.current = true;
    setCapturing(true);
    setError(null);
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        // Full pixels; Photo grade prep writes JPEG q=0.8 once.
        quality: 1,
        imageType: "jpg",
        skipProcessing: false,
      });
      if (photo && __DEV__) {
        console.info(`[grade-finder] ${side} still ${photo.width}x${photo.height} (pictureSize=${pictureSize ?? "default"})`);
      }
      const picked = stillFromCameraCapture({
        uri: photo?.uri,
        format: photo?.format,
        width: photo?.width,
        height: photo?.height,
      });
      if ("error" in picked) {
        setError(picked.error);
        return;
      }
      onCaptured(picked.still);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not take a photo. Try again.");
    } finally {
      busyRef.current = false;
      setCapturing(false);
    }
  }

  async function onCameraReady() {
    let size: string | undefined;
    try {
      const sizes = (await cameraRef.current?.getAvailablePictureSizesAsync()) ?? [];
      size = largestPictureSize(sizes);
    } catch {
      size = undefined;
    }
    // Same render batch: CameraView receives pictureSize before the shutter enables.
    setPictureSize(size);
    setPictureSizeResolved(true);
    setCameraReady(true);
  }

  async function openSettings() {
    try {
      await Linking.openSettings();
    } catch {
      setError("Open system Settings on your device to enable the camera.");
    }
  }

  const sideLabel = side === "front" ? "Front" : "Back";

  if (!permission) {
    return (
      <View style={styles.flex}>
        <FinderHeader onBack={onBack} title={`${sideLabel} photo`} />
        <View style={styles.panel}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  if (!showLivePreview) {
    const blocked = !IS_NATIVE
      ? "The live camera runs in the iOS and Android app. Choose a photo instead."
      : cameraMountFailed
      ? "Camera could not start. Choose a library photo, or try again."
      : permission.canAskAgain
        ? GRADE_CAMERA_PREPROMPT_BODY
        : "Enable camera in system Settings, or pick a photo from the library.";
    const canPrompt = IS_NATIVE && (permission.canAskAgain || cameraMountFailed);
    return (
      <View style={styles.flex}>
        <FinderHeader onBack={onBack} title={`${sideLabel} photo`} />
        <View style={styles.panel}>
          <Text style={styles.title}>
            {!IS_NATIVE || cameraMountFailed
              ? "Camera unavailable"
              : permission.canAskAgain
                ? GRADE_CAMERA_PREPROMPT_TITLE
                : CAMERA_DENIED_TITLE}
          </Text>
          <Text style={styles.body}>{blocked}</Text>
          {banner ? <Text style={styles.error}>{banner}</Text> : null}
          {canPrompt ? (
            <PrimaryButton
              label={CAMERA_ALLOW_LABEL}
              onPress={() => {
                setCameraMountFailed(false);
                void requestPermission();
              }}
            />
          ) : IS_NATIVE ? (
            <PrimaryButton
              label={OPEN_SETTINGS_LABEL}
              onPress={() => void openSettings()}
              tone="muted"
            />
          ) : null}
          <PrimaryButton label={CHOOSE_A_PHOTO_LABEL} onPress={onLibrary} tone="muted" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <FinderHeader onBack={detecting ? undefined : onBack} title={`${sideLabel} photo`} />
      <View style={styles.helper}>
        <Text style={styles.helperMain}>{GRADE_GUIDE_COPY.lineUp}</Text>
        <Text style={[styles.helperStatus, { color: guideColor }]}>{statusLine(readiness, level)}</Text>
      </View>
      <CardFinderStage
        cameraRef={cameraRef}
        enableLivePreview={showLivePreview}
        freezeUri={freezeUri}
        detecting={detecting}
        guideColor={guideColor}
        level={level}
        pictureSize={pictureSize}
        onCameraReady={() => void onCameraReady()}
        onMountError={() => setCameraMountFailed(true)}
      />
      {banner ? <Text style={styles.error}>{banner}</Text> : null}
      <View style={styles.toolbar}>
        <Pressable
          accessibilityLabel="Choose a photo"
          accessibilityRole="button"
          disabled={detecting}
          onPress={onLibrary}
          style={[styles.toolbarSide, detecting && styles.disabled]}
        >
          <Ionicons color={colors.text} name="images-outline" size={28} />
        </Pressable>
        <Pressable
          accessibilityLabel="Take photo"
          accessibilityRole="button"
          accessibilityState={{ disabled: shutterDisabled }}
          disabled={shutterDisabled}
          onPress={() => void onShutter()}
          style={[styles.shutterOuter, { borderColor: guideColor }, shutterDisabled && styles.disabled]}
        >
          {detecting || waitingForCamera ? (
            <ActivityIndicator color={colors.ctaText} />
          ) : (
            <View style={styles.shutterInner} />
          )}
        </Pressable>
        <View style={styles.toolbarSide} />
      </View>
    </View>
  );
}

function statusLine(readiness: GradeCaptureReadiness, level: DeviceLevel): string {
  if (!level.available || level.tiltDeg == null) return readiness.status;
  if (readiness.status === GRADE_GUIDE_COPY.holdFlat) {
    return `${GRADE_GUIDE_COPY.holdFlat} · ${level.tiltDeg.toFixed(1)}° off`;
  }
  return readiness.status;
}

function FinderHeader({ onBack, title }: { onBack?: () => void; title: string }) {
  return (
    <View style={styles.topBar}>
      {onBack ? (
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          hitSlop={12}
          onPress={onBack}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="chevron-back" size={28} />
        </Pressable>
      ) : (
        <View style={styles.iconButton} />
      )}
      <Text numberOfLines={1} style={styles.topTitle}>
        {title}
      </Text>
      <View style={styles.iconButton} />
    </View>
  );
}

interface CardFinderStageProps {
  cameraRef: RefObject<CameraView | null>;
  enableLivePreview: boolean;
  freezeUri: string | null;
  detecting: boolean;
  guideColor: string;
  level: DeviceLevel;
  pictureSize?: string;
  onCameraReady: () => void;
  onMountError: () => void;
}

function CardFinderStage({
  cameraRef,
  enableLivePreview,
  freezeUri,
  detecting,
  guideColor,
  level,
  pictureSize,
  onCameraReady,
  onMountError,
}: CardFinderStageProps) {
  const { width, height } = useWindowDimensions();
  const maxFrameHeight = Math.max(180, height * 0.46);
  const frameWidth = Math.min(width * 0.72, 280, maxFrameHeight * CARD_ASPECT_RATIO);
  const frameHeight = frameWidth / CARD_ASPECT_RATIO;

  return (
    <View style={styles.viewfinder}>
      <View style={styles.viewfinderStage}>
        {enableLivePreview ? (
          <CameraView
            ref={cameraRef}
            facing="back"
            mode="picture"
            mute
            pictureSize={pictureSize}
            onCameraReady={onCameraReady}
            onMountError={onMountError}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        {freezeUri ? (
          <Image
            accessibilityIgnoresInvertColors
            contentFit="cover"
            source={{ uri: freezeUri }}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View pointerEvents="none" style={styles.frameOverlay}>
          <View style={styles.dimBand} />
          <View style={styles.frameRow}>
            <View style={styles.dimBand} />
            <View style={{ width: frameWidth, height: frameHeight }}>
              <View style={[styles.frame, { borderColor: guideColor }]} />
              {(["tl", "tr", "bl", "br"] as const).map((corner) => (
                <View
                  key={corner}
                  style={[
                    styles.bracket,
                    {
                      borderColor: guideColor,
                      top: corner[0] === "t" ? -BRACKET_THICKNESS / 2 : undefined,
                      bottom: corner[0] === "b" ? -BRACKET_THICKNESS / 2 : undefined,
                      left: corner[1] === "l" ? -BRACKET_THICKNESS / 2 : undefined,
                      right: corner[1] === "r" ? -BRACKET_THICKNESS / 2 : undefined,
                      borderTopWidth: corner[0] === "t" ? BRACKET_THICKNESS : 0,
                      borderBottomWidth: corner[0] === "b" ? BRACKET_THICKNESS : 0,
                      borderLeftWidth: corner[1] === "l" ? BRACKET_THICKNESS : 0,
                      borderRightWidth: corner[1] === "r" ? BRACKET_THICKNESS : 0,
                    },
                  ]}
                />
              ))}
            </View>
            <View style={styles.dimBand} />
          </View>
          <View style={styles.dimBand} />
        </View>
        {!freezeUri && !detecting ? <LevelBubble color={guideColor} level={level} /> : null}
        {detecting ? (
          <View style={styles.detectScrim}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.detectText}>Finding the card…</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const BRACKET = 32;
const BRACKET_THICKNESS = 5;
const BUBBLE_RADIUS = 34;
const DOT_RADIUS = 7;
/** Pixels per degree: the outer ring is GRADE_LEVEL_NEAR_DEG + 2. */
const PX_PER_DEG = (BUBBLE_RADIUS - DOT_RADIUS) / (GRADE_LEVEL_NEAR_DEG + 2);

function LevelBubble({ level, color }: { level: DeviceLevel; color: string }) {
  if (!level.available || level.pitchDeg == null || level.rollDeg == null) return null;
  let dx = level.rollDeg * PX_PER_DEG;
  let dy = -level.pitchDeg * PX_PER_DEG;
  const max = BUBBLE_RADIUS - DOT_RADIUS;
  const dist = Math.hypot(dx, dy);
  if (dist > max) {
    dx = (dx / dist) * max;
    dy = (dy / dist) * max;
  }
  const target = Math.max(DOT_RADIUS + 2, GRADE_LEVEL_OK_DEG * PX_PER_DEG + DOT_RADIUS);
  return (
    <View
      accessibilityLabel={`Tilt ${level.tiltDeg?.toFixed(1) ?? "unknown"} degrees`}
      pointerEvents="none"
      style={styles.bubble}
    >
      <View style={[styles.bubbleRing, { borderColor: color }]} />
      <View
        style={[
          styles.bubbleTarget,
          { width: target * 2, height: target * 2, borderRadius: target, marginLeft: -target, marginTop: -target },
        ]}
      />
      <View
        style={[styles.bubbleDot, { backgroundColor: color, transform: [{ translateX: dx }, { translateY: dy }] }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg, minHeight: 0 },
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
  panel: {
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
  viewfinder: { flex: 1, minHeight: 0 },
  viewfinderStage: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: "#07090B",
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
    ...StyleSheet.absoluteFill,
    borderRadius: 14,
    borderWidth: 2,
    backgroundColor: "transparent",
  },
  bracket: { position: "absolute", width: BRACKET, height: BRACKET },
  bubble: {
    position: "absolute",
    top: space.sm,
    right: space.sm,
    width: BUBBLE_RADIUS * 2,
    height: BUBBLE_RADIUS * 2,
    alignItems: "center",
    justifyContent: "center",
  },
  bubbleRing: {
    ...StyleSheet.absoluteFill,
    borderRadius: BUBBLE_RADIUS,
    borderWidth: 2,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  bubbleTarget: {
    position: "absolute",
    left: "50%",
    top: "50%",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.7)",
  },
  bubbleDot: { width: DOT_RADIUS * 2, height: DOT_RADIUS * 2, borderRadius: DOT_RADIUS },
  helper: { alignItems: "center", gap: 2, paddingHorizontal: space.lg, paddingBottom: space.sm },
  helperMain: { color: colors.text, fontSize: 15, fontWeight: "700", textAlign: "center" },
  helperStatus: { fontSize: 14, fontWeight: "700", textAlign: "center" },
  detectScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(7, 9, 11, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  detectText: { color: colors.text, fontSize: 15, fontWeight: "700" },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md + TAB_CURVE_RADIUS,
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
