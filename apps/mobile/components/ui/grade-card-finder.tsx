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
  GRADE_AUTO_COPY,
  GRADE_AUTO_EXPLAINER,
  GRADE_STILL_MIN_SHORT_SIDE_PX,
  gradeFrameFillInPhoto,
  gradeCameraMountErrorAction,
  gradeProbePictureSize,
  type GradeAutoPhase,
  type GradeCaptureReadiness,
} from "@cardflow/shared";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useIsFocused } from "expo-router";
import { useRef, useState, type RefObject } from "react";
import {
  ActivityIndicator,
  Linking,
  PixelRatio,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  AccessibilityInfo,
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
import { useGradeAutoCapture } from "@/lib/use-grade-auto-capture";
import { useLevelHaptic, useReduceMotion } from "@/lib/use-grade-finder-feedback";
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
  /** Header override, e.g. "Front 1/7" in the full 14-photo mode. */
  title?: string;
  onCaptured: (still: PickedGradeStill) => void;
  onLibrary: () => void;
  onBack: () => void;
}

export function GradeCardFinder({
  side,
  detecting,
  freezeUri,
  notice,
  title,
  onCaptured,
  onLibrary,
  onBack,
}: GradeCardFinderProps) {
  const cameraRef = useRef<CameraView>(null);
  const busyRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraMountFailed, setCameraMountFailed] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const remountsRef = useRef<number[]>([]);
  function onCameraMountError(message: string | undefined) {
    const now = Date.now();
    const action = gradeCameraMountErrorAction(message, remountsRef.current, now);
    console.warn(`[grade-finder] camera mount error (${action}): ${message ?? "no message"}`);
    if (action === "ignore") return;
    if (action === "remount") {
      remountsRef.current = [...remountsRef.current.filter((t) => now - t < 60_000), now];
      setCameraReady(false);
      setCameraKey((k) => k + 1);
      return;
    }
    setCameraMountFailed(true);
  }
  const [error, setError] = useState<string | null>(null);

  const granted = permission?.granted === true;
  // Live camera is native-only, matching the Capture tab's gate.
  const showLivePreview = IS_NATIVE && granted && !cameraMountFailed;
  const [capturing, setCapturing] = useState(false);
  // Mobile Tech Lead review 1: the corner probes use a small (≈VGA) picture size; the real
  // shot always switches back to the largest size first.
  const [fullSize, setFullSize] = useState<string | undefined>(undefined);
  const [probeSize, setProbeSize] = useState<string | undefined>(undefined);
  const sizesResolvedRef = useRef(false);
  // The shutter waits until the largest picture size is resolved and passed to the
  // camera, so the first shot never uses the small default size.
  const [pictureSizeResolved, setPictureSizeResolved] = useState(false);
  const waitingForCamera = showLivePreview && (!cameraReady || !pictureSizeResolved);
  const shutterDisabled = detecting || waitingForCamera || capturing;
  const banner = error ?? notice ?? null;
  const isFocused = useIsFocused();
  // Tilt guide: feature-detected DeviceMotion; falls back to the static frame.
  const level = useDeviceLevel(showLivePreview && !freezeUri && isFocused);
  const screen = useWindowDimensions();
  const fontScale = PixelRatio.getFontScale();
  const frame = finderFrameSize(screen.width, screen.height);
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  const reduceMotion = useReduceMotion();
  // Auto-capture (Sean, Oct 17): 4 corners lined up with the green frame (2 probes in a row)
  // + level + steady for ~0.7 s. The manual shutter always works; without the sensor, its
  // permission, or the corner check it's manual only.
  const auto = useGradeAutoCapture({
    cameraRef,
    active: isFocused && showLivePreview && !freezeUri && !detecting && cameraReady && pictureSizeResolved,
    probeSizeAvailable: probeSize != null,
    layoutReady: stage != null,
    level,
    busy: shutterDisabled,
    frameFill: (photoWidth, photoHeight) =>
      stage
        ? gradeFrameFillInPhoto({
            stageWidth: stage.width,
            stageHeight: stage.height,
            frameHeight: frame.height,
            photoWidth,
            photoHeight,
          })
        : null,
    onFire: () => void onShutter("auto"),
  });
  const pictureSize = auto.probing && !capturing && probeSize ? probeSize : fullSize;
  const readiness = gradeCaptureReadiness({
    sensorAvailable: level.available,
    level: level.level,
    steady: level.steady,
    cardInFrame: auto.enabled ? auto.cardInFrame : null,
  });
  const holding = auto.phase === "holding" && auto.progress > 0;
  const guideColor = GUIDE_COLORS[holding ? "good" : readiness.tone];
  // UX review P0-1: the chip is the single hint. Auto phases speak with GRADE_AUTO_COPY.
  const autoChip = auto.phase !== "capturing" && auto.hint !== "";
  const statusPhrase = capturing ? GRADE_AUTO_COPY.capturing : autoChip ? auto.hint : statusLine(readiness);
  const chipIcon = capturing ? PHASE_ICONS.capturing : autoChip ? PHASE_ICONS[auto.phase] : TONE_ICONS[readiness.tone];
  const chipIsDefault = statusPhrase === GRADE_AUTO_COPY.fitCorners || statusPhrase === GRADE_GUIDE_COPY.lineUp;
  const tiltNote = statusPhrase === GRADE_AUTO_COPY.holdFlat || statusPhrase === GRADE_GUIDE_COPY.holdFlat ? tiltDetail(level) : null;
  const autoLine = autoHelperLine(auto.phase, level.available);
  const manualMode = !auto.enabled || auto.phase === "unavailable";

  // UX review P1-7: with Auto off or unavailable, one light tap when the phone first levels
  // (a light impact, in useLevelHaptic).
  useLevelHaptic(level.level, manualMode, capturing);

  function toggleAuto() {
    const next = !auto.enabled;
    auto.setEnabled(next);
    // UX review P1-3; Android reads the chip's live region instead.
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(next ? GRADE_AUTO_COPY.announceOn : GRADE_AUTO_COPY.announceOff);
    }
  }

  async function onShutter(via: "auto" | "manual" = "manual") {
    if (busyRef.current || shutterDisabled || !showLivePreview) return;
    busyRef.current = true;
    // UX review P0-3: feedback first, so a tap never feels dead while a probe finishes.
    // Setting capturing also switches the camera back to the full picture size.
    const wasProbeSize = probeSize != null && pictureSize === probeSize && probeSize !== fullSize;
    setCapturing(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Announce once per capture (iOS); Android reads the chip's live region.
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(GRADE_AUTO_COPY.capturing);
    setError(null);
    try {
      // Never overlap the small corner-probe still (waits 1.5 s at most); then start the cooldown.
      await auto.waitForProbe();
      auto.noteCapture();
      if (wasProbeSize) await sleep(SIZE_SWITCH_SETTLE_MS);
      if (__DEV__) console.info(`[grade-finder] ${side} capture via ${via}`);
      let photo = await takeFullPhoto();
      if (photo && wasProbeSize && Math.min(photo.width, photo.height) < GRADE_STILL_MIN_SHORT_SIDE_PX) {
        // The size switch hadn't applied yet: wait a little longer and retake once.
        await sleep(SIZE_SWITCH_SETTLE_MS);
        photo = await takeFullPhoto();
      }
      if (photo && __DEV__) {
        console.info(`[grade-finder] ${side} still ${photo.width}x${photo.height} (pictureSize=${fullSize ?? "default"})`);
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
      console.warn(`[grade-finder] ${side} capture failed: ${caught instanceof Error ? caught.message : String(caught)}`);
      setError("Couldn't take the photo. Hold still and tap the shutter again.");
    } finally {
      busyRef.current = false;
      setCapturing(false);
    }
  }

  function takeFullPhoto() {
    return cameraRef.current?.takePictureAsync({
      // Full pixels; Photo grade prep writes JPEG q=0.8 once.
      quality: 1,
      imageType: "jpg",
      skipProcessing: false,
    });
  }

  async function onCameraReady() {
    // A picture-size switch can fire onCameraReady again; resolve the sizes once.
    if (sizesResolvedRef.current) {
      setCameraReady(true);
      return;
    }
    let size: string | undefined;
    let small: string | undefined;
    try {
      const sizes = (await cameraRef.current?.getAvailablePictureSizesAsync()) ?? [];
      size = largestPictureSize(sizes);
      small = gradeProbePictureSize(sizes);
    } catch {
      size = undefined;
      small = undefined;
    }
    sizesResolvedRef.current = true;
    // Same render batch: CameraView receives pictureSize before the shutter enables.
    setFullSize(size);
    setProbeSize(small && small !== size ? small : undefined);
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
        <FinderHeader onBack={onBack} title={title ?? `${sideLabel} photo`} />
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
      ? "Camera couldn't start. Choose a library photo, or try again."
      : permission.canAskAgain
        ? GRADE_CAMERA_PREPROMPT_BODY
        : "Enable camera in system Settings, or pick a photo from the library.";
    const canPrompt = IS_NATIVE && (permission.canAskAgain || cameraMountFailed);
    return (
      <View style={styles.flex}>
        <FinderHeader onBack={onBack} title={title ?? `${sideLabel} photo`} />
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
      <FinderHeader onBack={detecting ? undefined : onBack} title={title ?? `${sideLabel} photo`} />
      <View style={styles.helper}>
        {auto.showExplainer ? (
          // Mobile Tech Lead review 8: one-time explainer; Auto waits until it's dismissed.
          <View accessibilityRole="summary" style={styles.explainer}>
            <Text style={styles.explainerTitle}>{GRADE_AUTO_EXPLAINER.title}</Text>
            <Text style={styles.explainerBody}>{GRADE_AUTO_EXPLAINER.body}</Text>
            <PrimaryButton label={GRADE_AUTO_EXPLAINER.ok} onPress={auto.dismissExplainer} />
          </View>
        ) : null}
        {chipIsDefault ? <Text style={styles.helperMain}>{GRADE_GUIDE_COPY.lineUp}</Text> : null}
        {/* Dark hint chip: icon + phrase, color only on the icon. The live region carries the
            phrase only (no %, no degrees), so it speaks when the phrase changes, not every tick. */}
        <View style={styles.hintChip}>
          <Ionicons color={guideColor} name={chipIcon} size={18} />
          <Text accessibilityLiveRegion="polite" style={styles.hintChipText}>
            {statusPhrase}
          </Text>
          {tiltNote ? (
            <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.hintChipText}>
              {tiltNote}
            </Text>
          ) : null}
        </View>
        {autoLine ? <Text style={styles.helperMain}>{autoLine}</Text> : null}
      </View>
      <CardFinderStage
        cameraRef={cameraRef}
        enableLivePreview={showLivePreview}
        freezeUri={freezeUri}
        detecting={detecting}
        guideColor={guideColor}
        frameWidth={frame.width}
        frameHeight={frame.height}
        level={level}
        pictureSize={pictureSize}
        onStageLayout={setStage}
        onCameraReady={() => void onCameraReady()}
        onMountError={onCameraMountError}
        cameraKey={cameraKey}
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
        <View style={styles.shutterWrap}>
          {/* UX review P1-5: no ring with Reduce Motion; the chip and shutter border show the hold. */}
          {holding && !reduceMotion ? <ProgressRing progress={auto.progress} /> : null}
          <Pressable
            accessibilityHint={auto.enabled ? GRADE_AUTO_COPY.shutterHintAuto : undefined}
            accessibilityLabel="Take photo"
            accessibilityRole="button"
            accessibilityState={{ busy: shutterDisabled }}
            onPress={() => void onShutter("manual")}
            style={[styles.shutterOuter, { borderColor: holding ? colors.accent : guideColor }]}
          >
            {detecting || waitingForCamera || capturing ? (
              <ActivityIndicator color={colors.ctaText} />
            ) : (
              <View style={styles.shutterInner} />
            )}
          </Pressable>
        </View>
        {/* UX review P1-1/P1-2/P2-3: scan icon (not a flash), state as text, hidden until the
            saved choice loads; at large text sizes the icon + label carry it. */}
        <Pressable
          accessibilityHint={GRADE_AUTO_COPY.toggleHint}
          accessibilityLabel={GRADE_AUTO_COPY.toggleLabel}
          accessibilityRole="switch"
          accessibilityState={{ checked: auto.enabled }}
          disabled={!auto.prefLoaded}
          hitSlop={8}
          onPress={toggleAuto}
          style={[styles.toggle, !auto.prefLoaded && styles.hidden]}
        >
          <Ionicons color={auto.enabled ? colors.text : colors.muted} name="scan-outline" size={24} />
          {fontScale < 1.5 ? (
            <>
              <Text style={[styles.autoToggleText, !auto.enabled && styles.autoToggleOff]}>{GRADE_AUTO_COPY.toggleTitle}</Text>
              <Text style={[styles.autoToggleText, !auto.enabled && styles.autoToggleOff]}>
                {auto.enabled ? GRADE_AUTO_COPY.on : GRADE_AUTO_COPY.off}
              </Text>
            </>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

function statusLine(readiness: GradeCaptureReadiness): string {
  return readiness.status;
}

/** Same frame size the overlay draws; the corner probe looks in the same place. */
function finderFrameSize(width: number, height: number): { width: number; height: number } {
  // Smaller than the old 72% / 280 pt frame so the phone sits ~22-25 cm away:
  // iPhone Pro main cameras can't focus much closer than ~20 cm, and the card
  // still spans ~30% of a 12 MP photo (~380 dpi, above the grader's 300 minimum).
  const maxFrameHeight = Math.max(160, height * 0.32);
  const frameWidth = Math.min(width * 0.46, 180, maxFrameHeight * CARD_ASPECT_RATIO);
  return { width: frameWidth, height: frameWidth / CARD_ASPECT_RATIO };
}

/** UX review P0-1: the line under the chip is only the manual reminder, while searching. */
function autoHelperLine(phase: GradeAutoPhase, sensor: boolean): string | null {
  return sensor && (phase === "searching" || phase === "cooldown") ? GRADE_AUTO_COPY.manualHint : null;
}

const SIZE_SWITCH_SETTLE_MS = 400;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const RING_SEGMENTS = 12;
const RING_RADIUS = 46;

/**
 * Hold progress around the shutter: dots light up clockwise from 12 o'clock over the ~0.7 s
 * hold (no animation library). UX review P1-4: theme colours, and lit dots are bigger so the
 * state doesn't depend on colour.
 */
function ProgressRing({ progress }: { progress: number }) {
  const lit = Math.round(progress * RING_SEGMENTS);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.ring}>
      {Array.from({ length: RING_SEGMENTS }, (_, i) => {
        const angle = (i / RING_SEGMENTS) * 2 * Math.PI - Math.PI / 2;
        const on = i < lit;
        return (
          <View
            key={i}
            style={[
              on ? styles.ringDotLit : styles.ringDot,
              {
                transform: [{ translateX: Math.cos(angle) * RING_RADIUS }, { translateY: Math.sin(angle) * RING_RADIUS }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

/** Visible-only tilt detail; never in the live region. */
function tiltDetail(level: DeviceLevel): string | null {
  if (!level.available || level.tiltDeg == null) return null;
  return `${level.tiltDeg.toFixed(1)}° off`;
}

const TONE_ICONS = {
  good: "checkmark-circle",
  warn: "alert-circle",
  bad: "close-circle",
  neutral: "scan-outline",
} as const;

/** UX review P0-1: chip icon by auto phase. */
const PHASE_ICONS = {
  searching: "alert-circle",
  cooldown: "alert-circle",
  holding: "checkmark-circle",
  capturing: "checkmark-circle",
  off: "hand-left-outline",
  unavailable: "hand-left-outline",
} as const;

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
      <Text style={styles.topTitle}>
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
  frameWidth: number;
  frameHeight: number;
  level: DeviceLevel;
  pictureSize?: string;
  onStageLayout: (size: { width: number; height: number }) => void;
  onCameraReady: () => void;
  onMountError: (message: string | undefined) => void;
  cameraKey: number;
}

function CardFinderStage({
  cameraRef,
  enableLivePreview,
  freezeUri,
  detecting,
  guideColor,
  frameWidth,
  frameHeight,
  level,
  pictureSize,
  onStageLayout,
  onCameraReady,
  onMountError,
  cameraKey,
}: CardFinderStageProps) {
  // expo-camera 57 has no tap-to-focus API. autofocus "off" is iOS continuous
  // autofocus (the default); "on" focuses once and locks. A tap flips to "on"
  // for a moment, which runs one fresh focus pass, then back to continuous.
  const [focusOnce, setFocusOnce] = useState(false);
  const refocus = () => {
    setFocusOnce(true);
    setTimeout(() => setFocusOnce(false), 600);
  };
  return (
    <View style={styles.viewfinder}>
      <View
        onLayout={(e) => onStageLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        onTouchEnd={refocus}
        style={styles.viewfinderStage}
      >
        {enableLivePreview ? (
          <CameraView
            key={cameraKey}
            ref={cameraRef}
            facing="back"
            mode="picture"
            mute
            // No flash on the silent corner-probe stills; the haptic marks the real capture.
            animateShutter={false}
            autofocus={focusOnce ? "on" : "off"}
            pictureSize={pictureSize}
            onCameraReady={onCameraReady}
            onMountError={(e) => onMountError(e?.message)}
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
      accessibilityLabel="Level indicator"
      accessibilityValue={{ text: level.tiltDeg != null && level.tiltDeg <= GRADE_LEVEL_OK_DEG ? "Level" : "Tilted" }}
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
  body: { color: colors.muted, fontSize: 15 },
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
  hintChip: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: space.xs,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  hintChipText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700", textAlign: "center", flexShrink: 1 },
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
  toggle: { minWidth: 56, minHeight: 56, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  hidden: { opacity: 0 },
  autoToggleText: { color: colors.text, fontSize: 13, fontWeight: "700", textAlign: "center" },
  autoToggleOff: { color: colors.muted },
  explainer: {
    alignSelf: "stretch",
    gap: space.xs,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: space.md,
    marginBottom: space.sm,
  },
  explainerTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  explainerBody: { color: colors.text, fontSize: 15 },
  shutterWrap: { width: 104, height: 104, alignItems: "center", justifyContent: "center" },
  ring: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  ringDot: { position: "absolute", width: 8, height: 8, borderRadius: 4, backgroundColor: colors.muted },
  ringDotLit: { position: "absolute", width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
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
