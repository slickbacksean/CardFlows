import {
  PREGRADE_DISCLAIMER,
  PREGRADE_LABEL,
  type PhotoPregradeSubgrade,
  type PhotoPregradeSuccess,
} from "@cardflow/shared";
import { Image } from "expo-image";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "@/components/ui/primary-button";
import { detectGradePhoto, requestPhotoPregrade } from "@/lib/api";
import { pickGradeStill, type PickedGradeStill } from "@/lib/grade-photos";
import { colors, space } from "@/lib/theme";

type Step = "guidelines" | "capture" | "crop" | "scoring" | "result";
type Side = "front" | "back";

interface SideStill {
  uri: string;
  mimeType: string | null;
  cropUri: string | null;
}

interface PhotoGradeFlowProps {
  onOpenPipeline: () => void;
}

const GUIDELINES = [
  "Lay the card flat and keep all four corners in the frame.",
  "Use even light. No sleeve, glare, or fingers on the card.",
  "Take the front, then the back. Catalog art is not a grade photo.",
  "Hold the phone flat over the card. A tilted angle means a retake.",
  "The result is an AI pre-grade estimate, not an official PSA, BGS, or CGC grade.",
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
  const [step, setStep] = useState<Step>("guidelines");
  const [side, setSide] = useState<Side>("front");
  const [front, setFront] = useState<SideStill | null>(null);
  const [back, setBack] = useState<SideStill | null>(null);
  const [detected, setDetected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [result, setResult] = useState<PhotoPregradeSuccess | null>(null);
  const [resultKind, setResultKind] = useState<"score" | "unavailable">("unavailable");
  const [unavailableMessage, setUnavailableMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const requestId = useRef(0);

  const current = side === "front" ? front : back;

  function reset() {
    requestId.current += 1;
    setStep("guidelines");
    setSide("front");
    setFront(null);
    setBack(null);
    setDetected(false);
    setNotice(null);
    setWarnings([]);
    setResult(null);
    setResultKind("unavailable");
    setUnavailableMessage(null);
    setChecking(false);
  }

  async function takePhoto(nextSide: Side, source: "camera" | "library") {
    setNotice(null);
    let picked: { still: PickedGradeStill } | { error: string } | null;
    try {
      picked = await pickGradeStill(source);
    } catch (caught) {
      setSide(nextSide);
      setStep("capture");
      setNotice(caught instanceof Error ? caught.message : "Could not open the camera.");
      return;
    }
    if (!picked) {
      const kept = nextSide === "front" ? front : back;
      setSide(nextSide);
      if (kept) setStep("crop");
      else setStep(nextSide === "front" ? "guidelines" : "capture");
      return;
    }
    if ("error" in picked) {
      setSide(nextSide);
      setStep("capture");
      setNotice(picked.error);
      return;
    }
    const still: SideStill = {
      uri: picked.still.uri,
      mimeType: picked.still.mimeType,
      cropUri: null,
    };
    if (nextSide === "front") setFront(still);
    else setBack(still);
    setSide(nextSide);
    setDetected(false);
    setStep("crop");
    await runDetect(nextSide, still);
  }

  async function runDetect(nextSide: Side, still: SideStill) {
    const id = ++requestId.current;
    setNotice(null);
    setWarnings([]);
    setDetected(false);
    setChecking(true);
    try {
      const found = await detectGradePhoto(still.uri, still.mimeType, nextSide);
      if (id !== requestId.current) return;
      if (!found.ok) {
        setDetected(false);
        setNotice(
          found.status === "retake"
            ? `Retake the photo: ${found.reasons.join(", ")}.`
            : `Couldn't check this photo. ${found.message}`,
        );
        return;
      }
      const cropUri = `data:${found.crop.mimeType};base64,${found.crop.base64}`;
      const next = { ...still, cropUri };
      if (nextSide === "front") setFront(next);
      else setBack(next);
      setDetected(true);
      setWarnings(found.warnings);
      setNotice(null);
    } catch {
      if (id !== requestId.current) return;
      setDetected(false);
      setNotice("Couldn't check this photo. Retake.");
    } finally {
      if (id === requestId.current) setChecking(false);
    }
  }

  function confirmCrop() {
    if (!detected || !current?.cropUri) return;
    if (side === "front") {
      setSide("back");
      setDetected(false);
      setNotice(null);
      void takePhoto("back", "camera");
      return;
    }
    void scorePhotos();
  }

  async function scorePhotos() {
    if (!front || !back) return;
    const id = ++requestId.current;
    setStep("scoring");
    setNotice(null);
    const graded = await requestPhotoPregrade({
      frontUri: front.uri,
      frontMimeType: front.mimeType,
      backUri: back.uri,
      backMimeType: back.mimeType,
    });
    if (id !== requestId.current) return;
    if (!graded.ok && graded.status === "retake") {
      const missed = graded.side === "back" ? "back" : "front";
      setSide(missed);
      setDetected(false);
      setWarnings([]);
      if (missed === "front") setFront((value) => (value ? { ...value, cropUri: null } : value));
      else setBack((value) => (value ? { ...value, cropUri: null } : value));
      setNotice(`Retake the ${missed} photo: ${graded.reasons.join(", ")}.`);
      setResult(null);
      setStep("crop");
      return;
    }
    if (!graded.ok) {
      setResult(null);
      setResultKind("unavailable");
      setUnavailableMessage(graded.message);
      setStep("result");
      return;
    }
    setResult(graded);
    setResultKind("score");
    setStep("result");
  }

  const sideLabel = side === "front" ? "Front" : "Back";

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.flex}>
      <Text style={styles.title}>Grading</Text>

      {step === "guidelines" ? (
        <View style={styles.block}>
          <Text style={styles.section}>Photo guidelines</Text>
          {GUIDELINES.map((line) => (
            <Text key={line} style={styles.body}>
              {line}
            </Text>
          ))}
          <PrimaryButton label="Take front photo" onPress={() => void takePhoto("front", "camera")} />
          <PrimaryButton
            label="Choose a photo"
            onPress={() => void takePhoto("front", "library")}
            tone="muted"
          />
          <PipelineLink onPress={onOpenPipeline} />
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
          {notice ? <Text style={styles.error}>{notice}</Text> : null}
          <PrimaryButton
            label={`Take ${sideLabel.toLowerCase()} photo`}
            onPress={() => void takePhoto(side, "camera")}
          />
          <PrimaryButton
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
          {!checking && notice ? <Text style={styles.error}>{notice}</Text> : null}
          {!checking && detected ? (
            <PrimaryButton label="Use this crop" onPress={confirmCrop} />
          ) : null}
          {!checking ? (
            <PrimaryButton
              label="Retake"
              onPress={() => void takePhoto(side, "camera")}
              tone={detected ? "muted" : "cta"}
            />
          ) : null}
          {!checking && !detected && notice ? (
            <PrimaryButton
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
              <Text style={styles.score}>{formatPregrade(result.estimate)}</Text>
              <Text style={styles.body}>{PREGRADE_DISCLAIMER}</Text>
              {result.warning ? <Text style={styles.warning}>{result.warning}</Text> : null}
              <View style={styles.pillar}>
                {PILLARS.map((id) => (
                  <Text key={id} style={styles.caption}>
                    {subgradeLine(id, result.subgrades[id])}
                  </Text>
                ))}
              </View>
              {result.note ? <Text style={styles.caption}>{`Note: ${result.note}.`}</Text> : null}
            </>
          ) : (
            <>
              <Text style={styles.body}>The grader is unavailable. No score.</Text>
              {unavailableMessage ? <Text style={styles.caption}>{unavailableMessage}</Text> : null}
            </>
          )}
          <PrimaryButton label="Grade another card" onPress={reset} />
          <PipelineLink onPress={onOpenPipeline} />
        </View>
      ) : null}
    </ScrollView>
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
  label: { color: colors.text, fontSize: 15, fontWeight: "700" },
  error: { color: colors.danger, fontSize: 15, lineHeight: 22 },
  warning: { color: colors.text, fontSize: 14, lineHeight: 20 },
  score: { color: colors.text, fontSize: 40, fontWeight: "800" },
  frame: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
    minHeight: 280,
  },
  frameImage: { width: "100%", height: 360, backgroundColor: colors.chip },
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
