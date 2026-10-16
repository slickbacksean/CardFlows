import {
  GradeJobCancelled,
  GradeJobError,
  CONDITION_LABELS,
  GRADE_ESTIMATE_EMPTY_COPY,
  GRADE_HISTORY_NOTE,
  GRADE_HISTORY_TITLE,
  gradeHistoryLines,
  type GradeHistoryEntry,
  GRADE_ESTIMATE_UNAVAILABLE_COPY,
  GRADE_PHOTOS_HINT,
  GRADE_SIDES,
  GRADE_SUBGRADE_IDS,
  GRADING_PILLARS,
  PREGRADE_LABEL,
  SLAB_PRICE_DISCLAIMER,
  SLAB_PRICE_EMPTY_COPY,
  WATCHLIST_CANNOT_SUBMIT_MESSAGE,
  confidenceLabel,
  emptyGradeEstimate,
  unavailableGradeEstimate,
  emptySlabEstimate,
  gradingMaxBuyGuidance,
  hasPrepareGradedAmounts,
  serializeGradeEstimate,
  slabRowLabel,
  rawRowLabel,
  typicalGradingFeeNote,
  type CardFlowGradeEstimate,
  type CardFlowSlabEstimate,
} from "@cardflow/shared";
import { trackEvent } from "@/lib/product-events";
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { GradeJobErrorCard, GradeWaitCard, useGradeWaitClock } from "./grade-wait-card";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, space } from "@/lib/theme";
import {
  firstPartyStillSource,
  getSlabEstimates,
  gradePhotoUri,
  requestGradeEstimate,
} from "@/lib/api";
import {
  pickGradeStill,
  promptGradeStillSource,
  type PickedGradeStill,
} from "@/lib/grade-photos";
import { getConfirmPictureUri } from "@/lib/scan-capture";
import { loadGradeHistory, recordGradeHistory } from "@/lib/grade-history";
import { PrimaryButton } from "./primary-button";

export interface PrepareMovePayload {
  condition: string | null;
  pillarAnswers: Record<string, string>;
  serviceLevelNote: string;
  estimateJson: string | null;
}

export interface PrepareSheetProps {
  visible: boolean;
  name: string;
  imageUrl: string | null;
  itemId: string | null;
  scanId?: string | null;
  imageStorageRef?: string | null;
  hasStoredFront?: boolean;
  hasStoredBack?: boolean;
  seedCondition: string | null;
  maxBuyAmount: string | null;
  tcgdexId?: string | null;
  estimate?: CardFlowGradeEstimate | null;
  canSubmit: boolean;
  onClose: () => void;
  onMoveToSubmitted: (payload: PrepareMovePayload) => void;
}

function seedConditionLabel(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return (CONDITION_LABELS as readonly string[]).includes(trimmed) ? trimmed : null;
}

export function PrepareSheet(props: PrepareSheetProps) {
  return (
    <PrepareSheetForm
      key={props.visible ? `open:${props.itemId ?? ""}:${props.seedCondition ?? ""}` : "closed"}
      {...props}
    />
  );
}

function PrepareSheetForm({
  visible,
  name,
  imageUrl,
  itemId,
  scanId,
  imageStorageRef,
  hasStoredFront = false,
  hasStoredBack = false,
  seedCondition,
  maxBuyAmount,
  tcgdexId,
  estimate,
  canSubmit,
  onClose,
  onMoveToSubmitted,
}: PrepareSheetProps) {
  const [condition, setCondition] = useState<string | null>(() =>
    seedConditionLabel(seedCondition),
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [serviceLevelNote, setServiceLevelNote] = useState("");
  const [fetchedEstimate, setFetchedEstimate] = useState<CardFlowGradeEstimate | null>(null);
  const [slabEstimate, setSlabEstimate] = useState<CardFlowSlabEstimate | null>(null);
  const [pickedFront, setPickedFront] = useState<PickedGradeStill | null>(null);
  const [pickedBack, setPickedBack] = useState<PickedGradeStill | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const storedFrontUri = itemId && hasStoredFront ? gradePhotoUri(itemId, "front") : null;
  const storedBackUri = itemId && hasStoredBack ? gradePhotoUri(itemId, "back") : null;
  const captureFrontUri = getConfirmPictureUri(scanId ?? undefined, imageStorageRef);
  const frontUri = pickedFront?.uri ?? storedFrontUri ?? captureFrontUri;
  const backUri = pickedBack?.uri ?? storedBackUri;
  const hasFront = Boolean(frontUri);

  const photoKey = `${pickedFront?.uri ?? ""}|${pickedBack?.uri ?? ""}|${captureFrontUri ?? ""}`;
  const [gradeHistory, setGradeHistory] = useState<GradeHistoryEntry[]>([]);
  const [photoKeySeen, setPhotoKeySeen] = useState(photoKey);
  if (photoKeySeen !== photoKey) {
    setPhotoKeySeen(photoKey);
    setFetchedEstimate(null);
  }
  if ((!visible || !tcgdexId) && slabEstimate) {
    setSlabEstimate(null);
  }

  // P1-07: wait card state for async grade jobs.
  const wait = useGradeWaitClock();
  const [jobError, setJobError] = useState<GradeJobError | null>(null);
  const [estimating, setEstimating] = useState(false);
  const runRef = useRef<AbortController | null>(null);

  function runEstimate(reestimate: boolean) {
    if (!itemId) return;
    runRef.current?.abort();
    const controller = new AbortController();
    runRef.current = controller;
    wait.reset();
    setJobError(null);
    setEstimating(true);
    const gradeStartedAt = Date.now();
    trackEvent(reestimate ? "grade_retake" : "grade_started");
    void requestGradeEstimate(
      itemId,
      {
        frontUri: pickedFront?.uri ?? (imageStorageRef ? null : captureFrontUri),
        frontMimeType: pickedFront?.mimeType,
        backUri: pickedBack?.uri,
        backMimeType: pickedBack?.mimeType,
        ...(reestimate ? { reestimate: true } : {}),
      },
      {
        signal: controller.signal,
        onJobUpdate: (job) => {
          if (!controller.signal.aborted) wait.onJobUpdate(job);
        },
        onPollError: (n) => {
          if (!controller.signal.aborted) wait.onPollError(n);
        },
      },
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        trackEvent("grade_shown", { ms_since_scan: Date.now() - gradeStartedAt });
        setFetchedEstimate(result);
        void recordGradeHistory(itemId, result).then((next) => {
          if (!controller.signal.aborted) setGradeHistory(next);
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || error instanceof GradeJobCancelled) return;
        if (error instanceof GradeJobError) setJobError(error);
        else setFetchedEstimate(unavailableGradeEstimate());
      })
      .finally(() => {
        if (runRef.current === controller) setEstimating(false);
      });
  }

  function cancelEstimate() {
    // Photos are kept; the server job expires on its own (TTL). A late result is dropped.
    runRef.current?.abort();
    runRef.current = null;
    setEstimating(false);
    wait.reset();
  }

  useEffect(() => {
    if (!visible || !itemId || estimate || !hasFront) return;
    // Next tick so the effect itself doesn't set state synchronously.
    const start = setTimeout(() => runEstimate(false), 0);
    return () => {
      clearTimeout(start);
      runRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureFrontUri, estimate, hasFront, imageStorageRef, itemId, pickedBack, pickedFront, visible]);

  useEffect(() => {
    if (!visible || !itemId) return;
    let cancelled = false;
    void loadGradeHistory(itemId).then((history) => {
      if (!cancelled) setGradeHistory(history);
    });
    return () => {
      cancelled = true;
    };
  }, [itemId, visible]);

  useEffect(() => {
    if (!visible || !tcgdexId) return;
    let cancelled = false;
    void getSlabEstimates(tcgdexId)
      .then((result) => {
        if (!cancelled) setSlabEstimate(result);
      })
      .catch(() => {
        if (!cancelled) setSlabEstimate(emptySlabEstimate(tcgdexId));
      });
    return () => {
      cancelled = true;
    };
  }, [tcgdexId, visible]);

  const guidance = gradingMaxBuyGuidance(maxBuyAmount);
  const feeNote = typicalGradingFeeNote(serviceLevelNote);
  const gradeEstimate = estimate ?? fetchedEstimate ?? emptyGradeEstimate();
  const confidence = confidenceLabel(gradeEstimate.confidence);
  const marketEstimate = tcgdexId ? (slabEstimate ?? emptySlabEstimate(tcgdexId)) : null;

  function moveToSubmitted() {
    if (!canSubmit) return;
    onMoveToSubmitted({
      condition,
      pillarAnswers: answers,
      serviceLevelNote,
      estimateJson: serializeGradeEstimate(gradeEstimate),
    });
  }

  function reestimate() {
    if (!itemId || !hasFront) return;
    setFetchedEstimate(null);
    runEstimate(true);
  }

  async function onPickStill(side: "front" | "back", source: "library" | "camera") {
    setPhotoError(null);
    try {
      const result = await pickGradeStill(source);
      if (!result) return;
      if ("error" in result) {
        setPhotoError(result.error);
        return;
      }
      if (side === "front") setPickedFront(result.still);
      else setPickedBack(result.still);
    } catch (caught) {
      setPhotoError(caught instanceof Error ? caught.message : "Could not add that photo.");
    }
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.backdrop}>
          <Pressable
            accessibilityLabel="Dismiss prepare sheet"
            accessibilityRole="button"
            onPress={onClose}
            style={styles.dismiss}
          />
          <SafeAreaView edges={["bottom"]} style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.title}>Prepare</Text>
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.heroWrap}>
                {imageUrl ? (
                  <Image
                    accessibilityIgnoresInvertColors
                    accessibilityLabel={`${name} catalog art`}
                    contentFit="contain"
                    source={{ uri: imageUrl }}
                    style={styles.hero}
                  />
                ) : (
                  <View
                    accessibilityLabel={`${name} catalog art`}
                    style={[styles.hero, styles.heroFallback]}
                  />
                )}
              </View>
              <Text style={styles.caption}>Catalog art — display only</Text>

              <Text style={styles.section}>Photos</Text>
              <Text style={styles.body}>{GRADE_PHOTOS_HINT}</Text>
              <View style={styles.photoRow}>
                <PhotoSlot
                  label="Front"
                  onPress={() => promptGradeStillSource((source) => void onPickStill("front", source))}
                  uri={frontUri}
                />
                <PhotoSlot
                  label="Back"
                  onPress={() => promptGradeStillSource((source) => void onPickStill("back", source))}
                  uri={backUri}
                />
              </View>
              {photoError ? <Text style={styles.error}>{photoError}</Text> : null}

              <View style={styles.guidance}>
                <Text style={styles.section}>{PREGRADE_LABEL}</Text>
                <Text style={styles.caption}>{gradeEstimate.disclaimer}</Text>
                {gradeHistory.length > 0 ? (
                  <View accessibilityLabel={GRADE_HISTORY_TITLE} accessible>
                    <Text style={styles.body}>{GRADE_HISTORY_TITLE}</Text>
                    {gradeHistoryLines(gradeHistory).map((line, index) => (
                      <Text key={`${index}-${line}`} style={styles.caption}>
                        {line}
                      </Text>
                    ))}
                    <Text style={styles.caption}>{GRADE_HISTORY_NOTE}</Text>
                  </View>
                ) : null}
                {estimating && !fetchedEstimate ? (
                  <GradeWaitCard clock={wait.clock} onCancel={cancelEstimate} />
                ) : jobError && !fetchedEstimate ? (
                  <GradeJobErrorCard onRetry={() => runEstimate(false)} retryAfterSeconds={jobError.retryAfterSeconds} />
                ) : gradeEstimate.overall == null ? (
                  <Text style={styles.body}>
                    {gradeEstimate.display === GRADE_ESTIMATE_UNAVAILABLE_COPY
                      ? GRADE_ESTIMATE_UNAVAILABLE_COPY
                      : gradeEstimate.display && gradeEstimate.display !== "No estimate"
                        ? gradeEstimate.display
                        : GRADE_ESTIMATE_EMPTY_COPY}
                  </Text>
                ) : (
                  <>
                    <Text
                      accessibilityLabel={`${PREGRADE_LABEL}, ${gradeEstimate.overall}`}
                      style={styles.estimateOverall}
                    >
                      {gradeEstimate.display}
                    </Text>
                    {confidence ? <Text style={styles.rowMeta}>{confidence}</Text> : null}
                    {GRADE_SIDES.map((side) => (
                      <View key={side} style={styles.pillar}>
                        <Text style={styles.label}>{side === "front" ? "Front" : "Back"}</Text>
                        {GRADE_SUBGRADE_IDS.map((id) => {
                          const row = gradeEstimate.subgrades.find(
                            (item) => item.id === id && item.side === side,
                          );
                          const score = row?.score == null ? "—" : String(row.score);
                          const ratio = row?.ratio ? ` · ${row.ratio}` : "";
                          return (
                            <Text key={`${side}-${id}`} style={styles.rowMeta}>
                              {id} {score}
                              {ratio}
                            </Text>
                          );
                        })}
                      </View>
                    ))}
                  </>
                )}
                {hasFront ? (
                  <PrimaryButton label="Re-estimate" onPress={reestimate} tone="muted" />
                ) : null}
              </View>

              {marketEstimate ? (
                <View style={styles.guidance}>
                  <Text style={styles.section}>Raw estimate</Text>
                  <Text style={styles.caption}>{SLAB_PRICE_DISCLAIMER}</Text>
                  {marketEstimate.rawRows.map((row) => (
                    <Text key={row.condition} style={styles.rowMeta}>
                      {rawRowLabel(row)} {row.display}
                    </Text>
                  ))}
                  {marketEstimate.rawRows.every((row) => row.amountCents === null) ? (
                    <Text style={styles.body}>{SLAB_PRICE_EMPTY_COPY}</Text>
                  ) : null}
                  {hasPrepareGradedAmounts(marketEstimate)
                    ? marketEstimate.rows.map((row) => (
                        <Text key={`${row.company}-${row.grade}`} style={styles.rowMeta}>
                          {slabRowLabel(row)} {row.display}
                        </Text>
                      ))
                    : null}
                </View>
              ) : null}

              <Text style={styles.section}>Your assessment</Text>
              {GRADING_PILLARS.map((pillar) => (
                <View key={pillar.id} style={styles.pillar}>
                  <Text style={styles.label}>{pillar.label}</Text>
                  <View style={styles.chips}>
                    {pillar.answers.map((answer) => (
                      <Chip
                        key={answer}
                        accessibilityLabel={`${pillar.label} ${answer}`}
                        label={answer}
                        onPress={() =>
                          setAnswers((current) => ({ ...current, [pillar.id]: answer }))
                        }
                        selected={answers[pillar.id] === answer}
                      />
                    ))}
                  </View>
                </View>
              ))}

              <Text style={styles.label}>Condition</Text>
              <View style={styles.chips}>
                {CONDITION_LABELS.map((label) => (
                  <Chip
                    key={label}
                    accessibilityLabel={`Condition ${label}`}
                    label={label}
                    onPress={() => setCondition(label)}
                    selected={condition === label}
                  />
                ))}
              </View>

              <View style={styles.guidance}>
                <Text style={styles.guidanceText}>{guidance}</Text>
                <Text style={styles.caption}>{feeNote}</Text>
              </View>

              <Text style={styles.label}>Service level (optional)</Text>
              <TextInput
                accessibilityLabel="Service level note"
                onChangeText={setServiceLevelNote}
                placeholder="Service level"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={serviceLevelNote}
              />
              <Text style={styles.body}>Your note. Typical fees above are not live.</Text>

              {canSubmit ? null : (
                <Text style={styles.error}>{WATCHLIST_CANNOT_SUBMIT_MESSAGE}</Text>
              )}
              <PrimaryButton
                disabled={!canSubmit}
                label="Move to Submitted"
                onPress={moveToSubmitted}
              />
            </ScrollView>
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface PhotoSlotProps {
  label: string;
  uri: string | null;
  onPress: () => void;
}

function PhotoSlot({ label, uri, onPress }: PhotoSlotProps) {
  const action = uri ? "Replace" : "Add";
  return (
    <Pressable
      accessibilityLabel={`${action} ${label} photo, required for a pre-grade estimate`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.photoSlot}
    >
      {uri ? (
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel={`${label} grade photo`}
          contentFit="cover"
          source={firstPartyStillSource(uri)}
          style={styles.photoStill}
        />
      ) : null}
      <Text style={[styles.photoLabel, uri ? styles.photoLabelOnStill : null]}>{label}</Text>
    </Pressable>
  );
}

interface ChipProps {
  accessibilityLabel?: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}

function Chip({ accessibilityLabel, label, selected, onPress }: ChipProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.55)",
  },
  dismiss: { flex: 1 },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    maxHeight: "92%",
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.muted,
    marginBottom: space.xs,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: "800", marginBottom: space.sm },
  content: { gap: space.md, paddingBottom: space.sm },
  heroWrap: { alignItems: "center" },
  hero: {
    width: 188,
    aspectRatio: 0.715,
    borderRadius: 16,
    backgroundColor: colors.chip,
  },
  heroFallback: { borderWidth: 1, borderColor: colors.cardBorder },
  caption: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  section: { color: colors.muted, fontWeight: "700", fontSize: 13, letterSpacing: 0.2 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  photoRow: { flexDirection: "row", gap: space.sm, maxWidth: 280 },
  photoSlot: {
    flex: 1,
    maxWidth: 132,
    aspectRatio: 0.715,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.chip,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  photoStill: { ...StyleSheet.absoluteFill },
  photoLabel: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  photoLabelOnStill: {
    color: colors.text,
    textShadowColor: "rgba(0, 0, 0, 0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  pillar: { gap: 8 },
  label: { color: colors.text, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  chip: {
    backgroundColor: colors.chip,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipLabel: { color: colors.muted, fontWeight: "700", fontSize: 13 },
  chipLabelSelected: { color: colors.accent },
  guidance: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: space.sm,
  },
  guidanceText: { color: colors.text, fontSize: 15, lineHeight: 22, fontWeight: "700" },
  estimateOverall: { color: colors.text, fontSize: 20, fontWeight: "800" },
  rowMeta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 16,
  },
  error: { color: colors.danger, fontSize: 14 },
});
