/**
 * Full 14-photo pre-grade (Sean, Oct 18; Premium + CARD_FLOW_GRADE_FULL_MODE=on): after the flat
 * photo of a side, guide the 6 extra shots: 2 tilted (auto-capture from the level sensor) and
 * 4 corner close-ups (manual shutter with a guide box). Each photo is blur-checked on the phone,
 * shown for Use/Retake, then sent to POST /v1/grade/extra. The camera permission was already
 * granted for the flat photo; a library-photo user gets the same pre-prompt as the finder.
 */
import {
  CAMERA_ALLOW_LABEL,
  GRADE_CAMERA_PREPROMPT_BODY,
  GRADE_CAMERA_PREPROMPT_TITLE,
  GRADE_EXTRA_SHOTS,
  GRADE_FULL_COPY,
  PREGRADE_COPY,
  gradeFullProgressLabel,
  gradeTiltShotHint,
  type GradeExtraShot,
} from "@cardflow/shared";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "@/components/ui/primary-button";
import { uploadGradeExtra } from "@/lib/api";
import { useDeviceLevel } from "@/lib/device-level";
import { checkGradeStillOnPhone } from "@/lib/phone-photo-check";
import { colors, space } from "@/lib/theme";

/** Hold inside the tilt window this long before the auto-capture fires. */
const TILT_HOLD_MS = 700;

const CORNER_BOX: Record<string, object> = {
  corner_tl: { top: "18%", left: "12%" },
  corner_tr: { top: "18%", right: "12%" },
  corner_br: { bottom: "22%", right: "12%" },
  corner_bl: { bottom: "22%", left: "12%" },
};

export function GradeExtraShots({
  side,
  onBack,
  onDone,
}: {
  side: "front" | "back";
  onBack: () => void;
  onDone: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [index, setIndex] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const shot: GradeExtraShot = GRADE_EXTRA_SHOTS[index] ?? "tilt_a";
  const isTilt = shot === "tilt_a" || shot === "tilt_b";
  const level = useDeviceLevel(isTilt && !preview);
  const tiltHint = isTilt ? gradeTiltShotHint(level.tiltDeg) : null;
  const tiltReady = isTilt && ready && !busy && !preview && level.available && tiltHint === null && level.steady !== false;

  async function capture() {
    if (busy || !cameraRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, imageType: "jpg" });
      if (!photo?.uri) throw new Error("no photo");
      const check = await checkGradeStillOnPhone(photo.uri, { fromGuide: false });
      // Blur only: a corner close-up is mostly background, so "nothing there" doesn't apply.
      if (check?.reasons.includes(PREGRADE_COPY.blurry)) setError(GRADE_FULL_COPY.blurry);
      setPreview(photo.uri);
    } catch (caught) {
      console.warn(`[grade-extra] ${side} ${shot} capture failed: ${caught instanceof Error ? caught.message : String(caught)}`);
      setError("Couldn't take the photo. Hold still and tap the shutter again.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!tiltReady) return;
    const timer = setTimeout(() => void capture(), TILT_HOLD_MS);
    return () => clearTimeout(timer);
    // capture reads the latest state through the ref'd camera; only the readiness matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiltReady, shot]);

  async function acceptPhoto() {
    if (!preview || busy) return;
    setBusy(true);
    try {
      await uploadGradeExtra({ uri: preview, side, shot });
    } catch (caught) {
      console.warn(`[grade-extra] ${side} ${shot} upload failed: ${caught instanceof Error ? caught.message : String(caught)}`);
      setError(GRADE_FULL_COPY.sendFailed);
      setBusy(false);
      return;
    }
    setBusy(false);
    setPreview(null);
    setError(null);
    if (index + 1 >= GRADE_EXTRA_SHOTS.length) onDone();
    else setIndex(index + 1);
  }

  const progress = gradeFullProgressLabel(side, index + 1);
  const header = (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>{progress}</Text>
    </View>
  );

  if (!permission?.granted) {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.pad}>
          <Text style={styles.prompt}>{GRADE_CAMERA_PREPROMPT_TITLE}</Text>
          <Text style={styles.body}>{GRADE_CAMERA_PREPROMPT_BODY}</Text>
          <PrimaryButton onPress={() => void requestPermission()} label={CAMERA_ALLOW_LABEL} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      <Text style={styles.prompt}>{GRADE_FULL_COPY.prompts[shot]}</Text>
      <View style={styles.stage}>
        {preview ? (
          <Image contentFit="contain" source={{ uri: preview }} style={StyleSheet.absoluteFill} />
        ) : (
          <CameraView
            autofocus="off"
            facing="back"
            onCameraReady={() => setReady(true)}
            onMountError={(e) => {
              console.warn(`[grade-extra] camera mount error: ${e?.message}`);
              setError("Camera paused. Hold on or go back and try again.");
            }}
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
          />
        )}
        {!preview && CORNER_BOX[shot] ? <View pointerEvents="none" style={[styles.cornerBox, CORNER_BOX[shot]]} /> : null}
        {busy ? <ActivityIndicator color="#fff" style={styles.spinner} /> : null}
      </View>
      <View style={styles.pad}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {preview ? (
          <>
            <PrimaryButton disabled={busy} onPress={() => void acceptPhoto()} label={GRADE_FULL_COPY.use} />
            <PrimaryButton disabled={busy} onPress={() => { setPreview(null); setError(null); }} label={GRADE_FULL_COPY.retake} tone="muted" />
          </>
        ) : (
          <>
            <Text style={styles.body}>
              {isTilt ? (level.available ? tiltHint ?? GRADE_FULL_COPY.tiltHold : "Tap the shutter when tilted about 20°.") : GRADE_FULL_COPY.cornerTap}
            </Text>
            <PrimaryButton disabled={busy || !ready} onPress={() => void capture()} label="Take photo" />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  header: { flexDirection: "row", alignItems: "center", paddingTop: 56, paddingHorizontal: space.md, gap: space.md },
  back: { paddingVertical: space.sm, paddingRight: space.md },
  backText: { color: "#fff", fontSize: 16 },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  prompt: { color: "#fff", fontSize: 16, paddingHorizontal: space.md, paddingVertical: space.sm },
  stage: { flex: 1, overflow: "hidden" },
  cornerBox: { position: "absolute", width: "34%", aspectRatio: 1, borderWidth: 3, borderColor: colors.accent, borderRadius: 8 },
  spinner: { position: "absolute", alignSelf: "center", top: "45%" },
  pad: { padding: space.md, gap: space.sm },
  body: { color: "#ddd", fontSize: 15 },
  error: { color: "#F06A5B", fontSize: 15 },
});
