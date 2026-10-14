import {
  GRADE_FLOW_RETAKE_HEADING,
  GRADE_FLOW_RETRY_LABEL,
  GRADE_FLOW_UNAVAILABLE_BODY,
  GRADE_QUOTA_COPY,
  PREGRADE_DISCLAIMER,
  PREGRADE_LABEL,
  remainingGradesCaption,
  retakeSideCopy,
  type GradeQuotaSnapshot,
  type PhotoPregradeSubgrade,
} from "@cardflow/shared";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { GradeCardFinder } from "@/components/ui/grade-card-finder";
import { PrimaryButton } from "@/components/ui/primary-button";
import { detectGradePhoto, getGradeQuota, grantGradeCredits, requestPhotoPregrade } from "@/lib/api";
import { gradeFlowSession } from "@/lib/grade-flow-session";
import {
  CARD_ASPECT_RATIO,
  pickGradeStill,
  prepareGradeStill,
  type PickedGradeStill,
} from "@/lib/grade-photos";
import { colors, space } from "@/lib/theme";

type Side = "front" | "back";

interface SideStill {
  uri: string;
  mimeType: string | null;
  cropUri: string | null;
  uploadId: string | null;
}

interface PhotoGradeFlowProps {
  onOpenPipeline: () => void;
}

const GUIDELINES = [
  "Lay the card flat and keep all four corners in the frame.",
  "Use even light. No sleeve, glare, or fingers on the card.",
  "Take the front, then the back. Catalog art is not a grade photo.",
  "Hold the phone flat over the card. A tilted angle means a retake.",
  `The result is a ${PREGRADE_LABEL.toLowerCase()}. ${PREGRADE_DISCLAIMER}`,
];

const PILLARS = ["centering", "corners", "edges", "surface"] as const;

function formatPregrade(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function sideValue(value: number | null): string {
  return value == null ? "—" : formatPregrade(value);
}

function subgradeLine(id: (typeof PILLARS)[number], row: PhotoPregradeSubgrade): string {
  if (row.front == null && row.back == null) {
    return `${id}: not graded${row.reason ? ` (${row.reason})` : ""}`;
  }
  return `${id}: front ${sideValue(row.front)} · back ${sideValue(row.back)}`;
}

export function PhotoGradeFlow({ onOpenPipeline }: PhotoGradeFlowProps) {
  const [state, setState] = useState(() => gradeFlowSession.getState());
  const requestId = useRef(0);

  useEffect(() => gradeFlowSession.subscribe(setState), []);
  useEffect(() => () => {
    gradeFlowSession.persistOnLeave();
  }, []);

  const {
    step,
    side,
    front,
    back,
    detected,
    notice,
    warnings,
    retakeReasons,
    result,
    resultKind,
    unavailableMessage,
    scoring,
    checking,
    freezeUri,
  } = state;
  const [quota, setQuota] = useState<GradeQuotaSnapshot | null>(null);
  const [quotaNotice, setQuotaNotice] = useState<string | null>(null);

  const refreshQuota = useCallback(() => {
    void getGradeQuota()
      .then((body) => setQuota(body.quota))
      .catch(() => setQuota(null));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshQuota();
    }, [refreshQuota]),
  );

  const current = side === "front" ? front : back;

  function patch(next: Partial<typeof state>) {
    gradeFlowSession.replace({ ...gradeFlowSession.getState(), ...next });
  }

  function reset() {
    requestId.current += 1;
    gradeFlowSession.reset();
    setQuotaNotice(null);
    refreshQuota();
  }

  const isOutOfGrades = (quota?.remainingGrades ?? 1) <= 0;

  function openFinder(nextSide: Side) {
    patch({
      side: nextSide,
      notice: null,
      detected: false,
      freezeUri: null,
      step: "finder",
    });
  }

  function handleFinderBack() {
    if (checking || scoring) return;
    const latest = gradeFlowSession.getState();
    if (latest.side === "back" && latest.front?.cropUri) {
      patch({ side: "front", detected: true, step: "crop" });
      return;
    }
    patch({ step: "guidelines" });
  }

  async function ingestStill(nextSide: Side, picked: PickedGradeStill, fromFinder: boolean) {
    const prepared =
      picked.mimeType === "image/jpeg" && !fromFinder
        ? { still: picked }
        : await prepareGradeStill(picked);
    if ("error" in prepared) {
      patch({
        side: nextSide,
        notice: prepared.error,
        retakeReasons: [],
        step: fromFinder ? gradeFlowSession.getState().step : "capture",
      });
      return;
    }
    const still: SideStill = {
      uri: prepared.still.uri,
      mimeType: prepared.still.mimeType,
      cropUri: null,
      uploadId: null,
    };
    patch({
      side: nextSide,
      front: nextSide === "front" ? still : gradeFlowSession.getState().front,
      back: nextSide === "back" ? still : gradeFlowSession.getState().back,
      detected: false,
      retakeReasons: [],
      notice: null,
      freezeUri: fromFinder ? still.uri : gradeFlowSession.getState().freezeUri,
      step: fromFinder ? gradeFlowSession.getState().step : "crop",
    });
    await runDetect(nextSide, still);
    if (fromFinder) patch({ freezeUri: null, step: "crop" });
  }

  async function takePhoto(nextSide: Side, source: "camera" | "library") {
    if (scoring) return;
    if (source === "camera") {
      openFinder(nextSide);
      return;
    }
    patch({ notice: null, retakeReasons: [] });
    let picked: { still: PickedGradeStill } | { error: string } | null;
    try {
      picked = await pickGradeStill(source);
    } catch (caught) {
      patch({
        side: nextSide,
        step: "capture",
        notice: caught instanceof Error ? caught.message : "Could not open the camera.",
      });
      return;
    }
    if (!picked) {
      if (gradeFlowSession.getState().step === "finder") return;
      const kept = nextSide === "front" ? gradeFlowSession.getState().front : gradeFlowSession.getState().back;
      patch({
        side: nextSide,
        step: kept ? "crop" : nextSide === "front" ? "guidelines" : "capture",
      });
      return;
    }
    if ("error" in picked) {
      patch({
        side: nextSide,
        notice: picked.error,
        step: gradeFlowSession.getState().step === "finder" ? "finder" : "capture",
      });
      return;
    }
    await ingestStill(nextSide, picked.still, false);
  }

  async function runDetect(nextSide: Side, still: SideStill) {
    const id = ++requestId.current;
    patch({
      notice: null,
      warnings: [],
      detected: false,
      checking: true,
      retakeReasons: [],
    });
    try {
      const found = await detectGradePhoto(still.uri, still.mimeType, nextSide);
      if (id !== requestId.current) return;
      if (!found.ok) {
        const reasons = found.status === "retake" ? found.reasons : [];
        patch({
          detected: false,
          checking: false,
          retakeReasons: reasons,
          notice:
            found.status === "retake"
              ? null
              : `Couldn't check this photo. ${found.message}`,
        });
        return;
      }
      const cropUri = `data:${found.crop.mimeType};base64,${found.crop.base64}`;
      const next = { ...still, cropUri, uploadId: found.uploadId ?? null };
      const latest = gradeFlowSession.getState();
      patch({
        front: nextSide === "front" ? next : latest.front,
        back: nextSide === "back" ? next : latest.back,
        detected: true,
        warnings: found.warnings,
        notice: null,
        retakeReasons: [],
        checking: false,
      });
    } catch {
      if (id !== requestId.current) return;
      patch({
        detected: false,
        checking: false,
        notice: "Couldn't check this photo. Retake.",
      });
    }
  }

  function confirmCrop() {
    const latest = gradeFlowSession.getState();
    if (latest.scoring || latest.checking) return;
    if (!latest.detected) return;
    const still = latest.side === "front" ? latest.front : latest.back;
    if (!still?.cropUri) return;
    if (latest.side === "front") {
      openFinder("back");
      return;
    }
    void scorePhotos();
  }

  async function runScoreRequest() {
    const latest = gradeFlowSession.getState();
    if (!latest.front || !latest.back || !latest.scoring) return;
    const graded = await requestPhotoPregrade({
      frontUri: latest.front.uri,
      frontMimeType: latest.front.mimeType,
      frontUploadId: latest.front.uploadId,
      backUri: latest.back.uri,
      backMimeType: latest.back.mimeType,
      backUploadId: latest.back.uploadId,
    });
    if (!gradeFlowSession.isSubmitLocked()) return;
    if (graded.quota) setQuota(graded.quota);
    if (!graded.ok && graded.status === "retake") {
      gradeFlowSession.applyRetake(graded.side === "back" ? "back" : "front", graded.reasons);
      return;
    }
    if (!graded.ok && graded.status === "out_of_grades") {
      if (graded.quota) setQuota(graded.quota);
      gradeFlowSession.applyUnavailable(graded.message);
      patch({ resultKind: "out_of_grades" });
      return;
    }
    if (!graded.ok) {
      gradeFlowSession.applyUnavailable(graded.message);
      return;
    }
    gradeFlowSession.applyScore(graded);
  }

  function scorePhotos() {
    if (!gradeFlowSession.beginSubmit()) return;
    void runScoreRequest();
  }

  function handleRetry() {
    if (!gradeFlowSession.retryUnavailable()) return;
    void runScoreRequest();
  }

  async function handleGetExtra() {
    setQuotaNotice(null);
    try {
      const result = await grantGradeCredits({ credits: 5 });
      setQuota(result.quota);
    } catch (caught) {
      setQuotaNotice(
        caught instanceof Error && caught.message
          ? caught.message
          : GRADE_QUOTA_COPY.iapUnavailable,
      );
    }
  }

  const sideLabel = side === "front" ? "Front" : "Back";

  if (step === "finder") {
    return (
      <GradeCardFinder
        detecting={checking}
        freezeUri={freezeUri}
        notice={notice ?? (retakeReasons.length > 0 ? retakeSideCopy(side, retakeReasons) : null)}
        onBack={handleFinderBack}
        onCaptured={(still) => void ingestStill(side, still, true)}
        onLibrary={() => void takePhoto(side, "library")}
        side={side}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.flex}>
      <Text style={styles.title}>Grading</Text>

      {step === "guidelines" ? (
        <View style={styles.block}>
          <Text style={styles.section}>Photo guidelines</Text>
          {quota ? (
            <Text
              accessibilityRole="text"
              style={isOutOfGrades ? styles.error : styles.body}
            >
              {remainingGradesCaption(quota)}
            </Text>
          ) : null}
          {isOutOfGrades ? (
            <View style={styles.block}>
              <Text style={styles.section}>Out of grades</Text>
              <Text style={styles.body}>{GRADE_QUOTA_COPY.outOfGrades}</Text>
              <Text style={styles.caption}>{GRADE_QUOTA_COPY.outOfGradesHint}</Text>
              {quotaNotice ? <Text style={styles.error}>{quotaNotice}</Text> : null}
              <PrimaryButton
                label={GRADE_QUOTA_COPY.getExtra}
                onPress={() => void handleGetExtra()}
                tone="muted"
              />
              <PipelineLink onPress={onOpenPipeline} />
            </View>
          ) : (
            <>
              {GUIDELINES.map((line) => (
                <Text key={line} style={styles.body}>
                  {line}
                </Text>
              ))}
              <PrimaryButton disabled={scoring} label="Take front photo" onPress={() => openFinder("front")} />
              <PrimaryButton
                disabled={scoring}
                label="Choose a photo"
                onPress={() => void takePhoto("front", "library")}
                tone="muted"
              />
              <PipelineLink onPress={onOpenPipeline} />
            </>
          )}
        </View>
      ) : null}

      {step === "capture" ? (
        <View style={styles.block}>
          <Text style={styles.section}>{sideLabel} photo</Text>
          <Text style={styles.body}>
            {side === "back"
              ? "Front crop saved. Take the back the same way."
              : "Keep the whole card in frame."}
          </Text>
          <RetakeReasons reasons={retakeReasons} side={side} />
          {notice ? <Text style={styles.error}>{notice}</Text> : null}
          <PrimaryButton
            disabled={scoring}
            label={`Take ${sideLabel.toLowerCase()} photo`}
            onPress={() => openFinder(side)}
          />
          <PrimaryButton
            disabled={scoring}
            label="Choose a photo"
            onPress={() => void takePhoto(side, "library")}
            tone="muted"
          />
        </View>
      ) : null}

      {step === "crop" ? (
        <View style={styles.block}>
          <Text style={styles.section}>{sideLabel} crop</Text>
          <View style={styles.frame}>
            {detected && current?.cropUri ? (
              <Image
                accessibilityIgnoresInvertColors
                accessibilityLabel={`${sideLabel} card crop`}
                contentFit="contain"
                source={{ uri: current.cropUri }}
                style={styles.frameImage}
              />
            ) : current?.uri ? (
              <Image
                accessibilityIgnoresInvertColors
                accessibilityLabel={`${sideLabel} photo`}
                contentFit="contain"
                source={{ uri: current.uri }}
                style={styles.frameImage}
              />
            ) : (
              <View style={styles.frameImage} />
            )}
            {checking ? (
              <View style={styles.finding}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.body}>Finding the card…</Text>
              </View>
            ) : null}
          </View>
          {!checking && detected ? <Text style={styles.body}>Card found. Use this crop?</Text> : null}
          {!checking && detected && warnings.length > 0 ? (
            <Text style={styles.warning}>
              {`Still gradable, but: ${warnings.join(", ")}. A retake may score more reliably.`}
            </Text>
          ) : null}
          <RetakeReasons reasons={retakeReasons} side={side} />
          {!checking && notice ? <Text style={styles.error}>{notice}</Text> : null}
          {!checking && detected ? (
            <PrimaryButton disabled={scoring} label="Use this crop" onPress={confirmCrop} />
          ) : null}
          {!checking ? (
            <PrimaryButton
              disabled={scoring}
              label="Retake"
              onPress={() => openFinder(side)}
              tone={detected ? "muted" : "cta"}
            />
          ) : null}
          {!checking && !detected && notice ? (
            <PrimaryButton
              disabled={scoring}
              label="Choose a photo"
              onPress={() => void takePhoto(side, "library")}
              tone="muted"
            />
          ) : null}
        </View>
      ) : null}

      {step === "scoring" ? (
        <View style={styles.block}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.body}>Grading both photos on your CardFlow server…</Text>
          <Text style={styles.caption}>This can take 10–30 seconds.</Text>
        </View>
      ) : null}

      {step === "result" ? (
        <View style={styles.block}>
          <Text style={styles.section}>{PREGRADE_LABEL}</Text>
          {resultKind === "score" && result ? (
            <>
              <Text
                accessibilityLabel={`${PREGRADE_LABEL}, ${formatPregrade(result.estimate)}`}
                style={styles.score}
              >
                {formatPregrade(result.estimate)}
              </Text>
              <Text style={styles.body}>{PREGRADE_DISCLAIMER}</Text>
              {quota ? <Text style={styles.caption}>{remainingGradesCaption(quota)}</Text> : null}
              {result.warning ? <Text style={styles.warning}>{result.warning}</Text> : null}
              <View style={styles.pillar}>
                {PILLARS.map((id) => (
                  <Text key={id} style={styles.caption}>
                    {subgradeLine(id, result.subgrades[id])}
                  </Text>
                ))}
              </View>
              {result.note ? <Text style={styles.caption}>{`Note: ${result.note}.`}</Text> : null}
              <PrimaryButton disabled={scoring} label="Grade another card" onPress={reset} />
            </>
          ) : resultKind === "out_of_grades" ? (
            <>
              <Text style={styles.section}>Out of grades</Text>
              <Text style={styles.body}>{GRADE_QUOTA_COPY.outOfGrades}</Text>
              <Text style={styles.caption}>{GRADE_QUOTA_COPY.outOfGradesHint}</Text>
              {quotaNotice ? <Text style={styles.error}>{quotaNotice}</Text> : null}
              <PrimaryButton
                label={GRADE_QUOTA_COPY.getExtra}
                onPress={() => void handleGetExtra()}
                tone="muted"
              />
              <PrimaryButton label="Grade another card" onPress={reset} tone="muted" />
            </>
          ) : (
            <>
              <Text style={styles.body}>{GRADE_FLOW_UNAVAILABLE_BODY}</Text>
              {unavailableMessage ? <Text style={styles.caption}>{unavailableMessage}</Text> : null}
              <PrimaryButton
                disabled={scoring}
                label={GRADE_FLOW_RETRY_LABEL}
                onPress={handleRetry}
              />
              <PrimaryButton
                disabled={scoring}
                label="Grade another card"
                onPress={reset}
                tone="muted"
              />
            </>
          )}
          <PipelineLink onPress={onOpenPipeline} />
        </View>
      ) : null}
    </ScrollView>
  );
}

function RetakeReasons({ reasons, side }: { reasons: string[]; side: Side }) {
  if (reasons.length === 0) return null;
  return (
    <View style={styles.retakeBox}>
      <Text style={styles.retakeHeading}>{GRADE_FLOW_RETAKE_HEADING}</Text>
      <Text style={styles.retakeSide}>{side === "back" ? "Back photo" : "Front photo"}</Text>
      {reasons.map((reason) => (
        <Text key={reason} style={styles.error}>
          {reason}
        </Text>
      ))}
    </View>
  );
}

function PipelineLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.linkHit}>
      <Text style={styles.link}>Prepare, Submitted, Returned</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: 48 },
  block: { gap: space.md },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  section: { color: colors.text, fontSize: 18, fontWeight: "800" },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  caption: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 15, lineHeight: 22 },
  warning: { color: colors.text, fontSize: 14, lineHeight: 20 },
  score: { color: colors.text, fontSize: 40, fontWeight: "800" },
  retakeBox: { gap: space.xs },
  retakeHeading: { color: colors.text, fontSize: 16, fontWeight: "800" },
  retakeSide: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  frame: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
    minHeight: 280,
  },
  frameImage: {
    width: "70%",
    aspectRatio: CARD_ASPECT_RATIO,
    maxHeight: 360,
    alignSelf: "center",
    backgroundColor: colors.chip,
  },
  finding: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: space.md,
    alignItems: "center",
    gap: space.sm,
  },
  pillar: { gap: 2 },
  linkHit: { alignSelf: "flex-start", paddingVertical: space.xs },
  link: { color: colors.accent, fontSize: 15, fontWeight: "700" },
});
