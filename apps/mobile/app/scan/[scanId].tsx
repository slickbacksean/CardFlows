import Ionicons from "@expo/vector-icons/Ionicons";
import {
  CATALOG_SEARCH_HINT,
  CONFIRM_AMBIGUOUS_TITLE,
  CONFIRM_COULD_NOT_CONFIRM_MESSAGE,
  CONFIRM_SEARCH_FRAMES,
  CONFIRM_SEARCH_MANUALLY_LABEL,
  confirmFailSoftBody,
  confirmFailSoftTitle,
  confirmFrameFromScan,
  type CardFlowCanonicalCard,
  type ConfirmFrame,
} from "@cardflow/shared";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/ui/primary-button";
import { confirmScan, getScan, rejectScan, searchCatalog, type ScanRecord } from "@/lib/api";
import { getConfirmPictureUri } from "@/lib/scan-capture";
import { colors, space } from "@/lib/theme";

const MANUAL_SEARCH_FRAMES = new Set<ConfirmFrame>(CONFIRM_SEARCH_FRAMES);

export default function ScanScreen() {
  const router = useRouter();
  const { scanId: scanIdParam } = useLocalSearchParams<{ scanId: string }>();
  const scanId = Array.isArray(scanIdParam) ? scanIdParam[0] : scanIdParam;
  const [scan, setScan] = useState<ScanRecord | null>(null);
  const [selectedTcgdexId, setSelectedTcgdexId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [searchSet, setSearchSet] = useState("");
  const [searchNumber, setSearchNumber] = useState("");
  const [searchCards, setSearchCards] = useState<CardFlowCanonicalCard[]>([]);
  const [searchCached, setSearchCached] = useState(false);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!scanId) {
        setError("Scan not found");
        return;
      }
      try {
        const data = await getScan(scanId);
        if (cancelled) return;
        setScan(data.scan);
        setSelectedTcgdexId(
          data.scan.mapping.canonicalCard?.tcgdexId ??
            data.scan.mapping.candidates[0]?.tcgdexId ??
            null,
        );
        setSearchSet("");
        setSearchNumber("");
        setSearchCards([]);
        setSearchCached(false);
        setSearchNotice(null);
        setRejected(data.scan.preInventoryState === "identity_rejected");
        setError(null);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not load scan");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  const options = useMemo(() => {
    if (!scan) return searchCards;
    const mapped = scan.mapping.canonicalCard
      ? [scan.mapping.canonicalCard]
      : scan.mapping.candidates;
    const byId = new Map<string, CardFlowCanonicalCard>();
    for (const card of [...mapped, ...searchCards]) {
      byId.set(card.tcgdexId, card);
    }
    return [...byId.values()];
  }, [scan, searchCards]);

  const selected = options.find((card) => card.tcgdexId === selectedTcgdexId) ?? null;
  const frame = rejected
    ? "rejected"
    : scan
      ? confirmFrameFromScan({
          recognitionOk: scan.recognition.ok,
          recognitionCode: scan.recognition.error?.code,
          detectionCount: scan.recognition.detections.length,
          mappingStatus: scan.mapping.status,
          hasCanonicalCard: Boolean(scan.mapping.canonicalCard),
          scenario: scan.scenario,
        })
      : null;
  const captureUri = getConfirmPictureUri(scanId, scan?.imageStorageRef);
  const showManualSearch = frame ? MANUAL_SEARCH_FRAMES.has(frame) : false;

  async function onSearch() {
    setIsSearching(true);
    setError(null);
    try {
      const result = await searchCatalog({ set: searchSet, number: searchNumber });
      setSearchCards(result.cards);
      setSearchCached(result.cached);
      setSearchNotice(
        result.notice ?? (result.error && result.cards.length === 0 ? result.error.message : null),
      );
      if (result.cards.length === 1) {
        setSelectedTcgdexId(result.cards[0]?.tcgdexId ?? null);
      } else if (
        selectedTcgdexId &&
        !result.cards.some((card) => card.tcgdexId === selectedTcgdexId)
      ) {
        setSelectedTcgdexId(null);
      }
      if (result.cards.length === 0 && !result.notice && !result.error) {
        setSearchNotice("No English catalog row for that set and number.");
      }
    } catch (caught) {
      setSearchCards([]);
      setSearchCached(false);
      setSearchNotice(caught instanceof Error ? caught.message : "Catalog search failed");
    } finally {
      setIsSearching(false);
    }
  }

  function goToCapture() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/capture");
  }

  function leaveFlow() {
    router.replace("/(tabs)/collection");
  }

  async function onConfirm() {
    if (!scan || !selectedTcgdexId) return;
    setIsConfirming(true);
    setError(null);
    try {
      const result = await confirmScan(scan.scanId, { tcgdexId: selectedTcgdexId });
      const cardflowCardId = result.canonicalCard.cardflowCardId;
      router.push({
        pathname: "/decide/[cardflowCardId]",
        params: {
          cardflowCardId: cardflowCardId as string,
          confirmationId: result.confirmation.confirmationId,
          scanId: result.scan.scanId,
        },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Confirm failed");
    } finally {
      setIsConfirming(false);
    }
  }

  async function onReject() {
    if (!scan || isConfirming) return;
    setIsConfirming(true);
    setError(null);
    try {
      const result = await rejectScan(scan.scanId);
      setScan(result.scan);
      setRejected(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reject that scan");
    } finally {
      setIsConfirming(false);
    }
  }

  const manualSearch = showManualSearch ? (
    <ManualCatalogSearch
      cached={searchCached}
      cards={searchCards}
      isSearching={isSearching}
      notice={searchNotice}
      number={searchNumber}
      onNumberChange={setSearchNumber}
      onSearch={() => void onSearch()}
      onSelect={setSelectedTcgdexId}
      selectedTcgdexId={selectedTcgdexId}
      setName={searchSet}
      onSetNameChange={setSearchSet}
    />
  ) : null;

  const failureConfirm =
    showManualSearch && frame !== "ambiguous" && selected ? (
      <View style={styles.stack}>
        <IdentityCopy card={selected} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton
          disabled={isConfirming}
          label={isConfirming ? "Confirming…" : "Confirm identity"}
          onPress={() => void onConfirm()}
        />
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="Cancel"
          accessibilityRole="button"
          hitSlop={12}
          onPress={goToCapture}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="close" size={28} />
        </Pressable>
        <Text style={styles.topTitle}>Confirm card</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!scan && !error ? <Text style={styles.body}>Loading scan…</Text> : null}
        {!scan && error ? (
          <FailureBody
            title="Could not load scan"
            body={error}
            actionLabel="Retake"
            onAction={goToCapture}
          />
        ) : null}

        {scan && frame === "high" && selected ? (
          <HighConfirm
            captureUri={captureUri}
            card={selected}
            error={error}
            isConfirming={isConfirming}
            onConfirm={() => void onConfirm()}
            onReject={() => void onReject()}
          />
        ) : null}

        {scan && frame === "ambiguous" ? (
          <AmbiguousConfirm
            captureUri={captureUri}
            cards={scan.mapping.candidates}
            error={error}
            isConfirming={isConfirming}
            onConfirm={() => void onConfirm()}
            onReject={() => void onReject()}
            onSelect={setSelectedTcgdexId}
            selectedTcgdexId={selectedTcgdexId}
          />
        ) : null}

        {scan && frame === "no-card" ? (
          <FailureBody
            title={confirmFailSoftTitle("no-card")}
            body={confirmFailSoftBody("no-card")}
            actionLabel="Retake"
            onAction={goToCapture}
          >
            <Text style={styles.kicker}>Your picture</Text>
            <CaptureSlot uri={captureUri} />
            {manualSearch}
            {failureConfirm}
          </FailureBody>
        ) : null}

        {scan && frame === "timeout" ? (
          <FailureBody
            title={confirmFailSoftTitle("timeout")}
            body={confirmFailSoftBody("timeout")}
            actionLabel="Retry"
            onAction={goToCapture}
          >
            {manualSearch}
            {failureConfirm}
          </FailureBody>
        ) : null}

        {scan && frame === "rate-limit" ? (
          <FailureBody
            title={confirmFailSoftTitle("rate-limit")}
            body={confirmFailSoftBody("rate-limit")}
            meta="Retry after ~30s"
            actionLabel="Retry"
            onAction={goToCapture}
          >
            {manualSearch}
            {failureConfirm}
          </FailureBody>
        ) : null}

        {scan && frame === "no-match" ? (
          <FailureBody
            title={confirmFailSoftTitle("no-match")}
            body={confirmFailSoftBody("no-match")}
            actionLabel="Retake"
            onAction={goToCapture}
          >
            <Text style={styles.kicker}>Your picture</Text>
            <CaptureSlot uri={captureUri} />
            {manualSearch}
            {failureConfirm}
          </FailureBody>
        ) : null}

        {scan && frame === "ambiguous" ? manualSearch : null}

        {scan && frame === "rejected" ? (
          <FailureBody
            title="Not this card"
            body="This scan stays out of Collection. No card is added."
            actionLabel="Retake photo"
            onAction={goToCapture}
            secondaryLabel="Back"
            onSecondary={leaveFlow}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function variantLabel(card: CardFlowCanonicalCard): string {
  if (card.selectedVariant) return card.selectedVariant;
  if (card.variants.normal) return "normal";
  if (card.variants.holo) return "holo";
  if (card.variants.reverse) return "reverse";
  if (card.variants.firstEdition) return "1st edition";
  return "raw";
}

interface HighConfirmProps {
  captureUri: string | null;
  card: CardFlowCanonicalCard;
  error: string | null;
  isConfirming: boolean;
  onConfirm: () => void;
  onReject: () => void;
}

function HighConfirm({
  captureUri,
  card,
  error,
  isConfirming,
  onConfirm,
  onReject,
}: HighConfirmProps) {
  return (
    <View style={styles.stack}>
      <View style={styles.pictureRow}>
        <View style={styles.pictureCol}>
          <Text style={styles.kicker}>Your picture</Text>
          <CaptureSlot uri={captureUri} />
        </View>
        <View style={styles.pictureCol}>
          <Text style={styles.kicker}>Matching cards</Text>
          <CatalogThumb card={card} selected />
        </View>
      </View>
      <IdentityCopy card={card} />
      <Text style={styles.body}>Nothing is added until Confirm.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        disabled={isConfirming}
        label={isConfirming ? "Confirming…" : "Confirm identity"}
        onPress={onConfirm}
      />
      <GhostButton disabled={isConfirming} label="Not this card" onPress={onReject} />
    </View>
  );
}

interface AmbiguousConfirmProps {
  captureUri: string | null;
  cards: CardFlowCanonicalCard[];
  selectedTcgdexId: string | null;
  isConfirming: boolean;
  error: string | null;
  onSelect: (tcgdexId: string) => void;
  onConfirm: () => void;
  onReject: () => void;
}

function AmbiguousConfirm({
  captureUri,
  cards,
  selectedTcgdexId,
  isConfirming,
  error,
  onSelect,
  onConfirm,
  onReject,
}: AmbiguousConfirmProps) {
  const picked = cards.find((card) => card.tcgdexId === selectedTcgdexId) ?? null;

  return (
    <View style={styles.stack}>
      <Text style={styles.title}>{CONFIRM_AMBIGUOUS_TITLE}</Text>
      <Text style={styles.kicker}>Your picture</Text>
      <CaptureSlot uri={captureUri} />
      <Text style={styles.kicker}>Matching cards</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
        {cards.map((card) => (
          <CatalogThumb
            key={card.tcgdexId}
            card={card}
            label={`#${card.localId}`}
            onPress={() => onSelect(card.tcgdexId)}
            selected={selectedTcgdexId === card.tcgdexId}
          />
        ))}
      </ScrollView>
      {picked ? <IdentityCopy card={picked} /> : null}
      <Text style={styles.body}>{CONFIRM_COULD_NOT_CONFIRM_MESSAGE}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        disabled={!selectedTcgdexId || isConfirming}
        label={isConfirming ? "Confirming…" : "Confirm identity"}
        onPress={onConfirm}
      />
      <GhostButton disabled={isConfirming} label="None of these" onPress={onReject} />
    </View>
  );
}

interface FailureBodyProps {
  title: string;
  body: string;
  meta?: string;
  actionLabel: string;
  onAction: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  children?: ReactNode;
}

function FailureBody({
  title,
  body,
  meta,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  children,
}: FailureBodyProps) {
  return (
    <View style={styles.stack}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {meta ? <Text style={styles.body}>{meta}</Text> : null}
      {children}
      <PrimaryButton label={actionLabel} onPress={onAction} />
      {secondaryLabel && onSecondary ? (
        <GhostButton label={secondaryLabel} onPress={onSecondary} />
      ) : null}
    </View>
  );
}

interface ManualCatalogSearchProps {
  setName: string;
  number: string;
  onSetNameChange: (value: string) => void;
  onNumberChange: (value: string) => void;
  onSearch: () => void;
  isSearching: boolean;
  cards: CardFlowCanonicalCard[];
  selectedTcgdexId: string | null;
  onSelect: (tcgdexId: string) => void;
  cached: boolean;
  notice: string | null;
}

function ManualCatalogSearch({
  setName,
  number,
  onSetNameChange,
  onNumberChange,
  onSearch,
  isSearching,
  cards,
  selectedTcgdexId,
  onSelect,
  cached,
  notice,
}: ManualCatalogSearchProps) {
  return (
    <View style={styles.stack}>
      <Text style={styles.kicker}>{CONFIRM_SEARCH_MANUALLY_LABEL}</Text>
      <Text style={styles.body}>{CATALOG_SEARCH_HINT}</Text>
      <TextInput
        accessibilityLabel="English set name or id"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onSetNameChange}
        placeholder="Set (e.g. Base Set)"
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={setName}
      />
      <TextInput
        accessibilityLabel="Card number"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onNumberChange}
        placeholder="Number (e.g. 58)"
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={number}
      />
      <PrimaryButton
        disabled={isSearching || !setName.trim() || !number.trim()}
        label={isSearching ? "Searching…" : "Search catalog"}
        onPress={onSearch}
        tone="muted"
      />
      {notice ? <Text style={styles.body}>{notice}</Text> : null}
      {cached ? <Text style={styles.body}>Cached catalog — it may be stale.</Text> : null}
      {cards.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbs}
        >
          {cards.map((card) => (
            <CatalogThumb
              key={card.tcgdexId}
              card={card}
              label={`#${card.localId}`}
              onPress={() => onSelect(card.tcgdexId)}
              selected={selectedTcgdexId === card.tcgdexId}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function IdentityCopy({ card }: { card: CardFlowCanonicalCard }) {
  const language = (card.language ?? "en").toUpperCase();
  return (
    <View style={styles.identity}>
      <Text style={styles.cardName}>{card.name}</Text>
      <Text style={styles.metaLine}>
        {card.category} #{card.localId} {language} ({variantLabel(card)})
      </Text>
      <Text style={styles.metaLine}>{card.set.name}</Text>
    </View>
  );
}

function CaptureSlot({ uri }: { uri: string | null }) {
  return (
    <View accessibilityLabel="Your picture" style={styles.captureSlot}>
      {uri ? (
        <Image
          accessibilityIgnoresInvertColors
          contentFit="cover"
          source={{ uri }}
          style={styles.captureImage}
        />
      ) : (
        <>
          <Ionicons color={colors.muted} name="image-outline" size={28} />
          <Text style={styles.captureHint}>still</Text>
        </>
      )}
    </View>
  );
}

interface CatalogThumbProps {
  card: CardFlowCanonicalCard;
  selected?: boolean;
  label?: string;
  onPress?: () => void;
}

function CatalogThumb({ card, selected, label, onPress }: CatalogThumbProps) {
  const inner = (
    <>
      {card.image.constructedUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          source={{ uri: card.image.constructedUrl }}
          style={styles.thumbImage}
        />
      ) : (
        <View style={styles.thumbImage} />
      )}
      {label ? <Text style={styles.thumbLabel}>{label}</Text> : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.thumb, selected && styles.thumbSelected]}>{inner}</View>;
  }

  return (
    <Pressable
      accessibilityLabel={`${card.name} #${card.localId}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.thumb, selected && styles.thumbSelected]}
    >
      {inner}
    </Pressable>
  );
}

interface GhostButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

function GhostButton({ label, onPress, disabled }: GhostButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.ghost, disabled && styles.disabled]}
    >
      <Text style={styles.ghostLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
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
  content: { padding: space.lg, gap: space.md, paddingBottom: 48 },
  stack: { gap: space.md },
  pictureRow: { flexDirection: "row", gap: space.md },
  pictureCol: { flex: 1, gap: space.xs },
  kicker: {
    color: colors.muted,
    fontWeight: "700",
    fontSize: 13,
    letterSpacing: 0.2,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: "800", lineHeight: 28 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  error: { color: colors.danger, fontSize: 14 },
  identity: { gap: 4 },
  cardName: { color: colors.text, fontSize: 22, fontWeight: "800" },
  metaLine: { color: colors.muted, fontSize: 15, lineHeight: 22 },
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
  captureSlot: {
    height: 168,
    borderRadius: 12,
    backgroundColor: "#0B0E11",
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    overflow: "hidden",
  },
  captureImage: {
    width: "100%",
    height: "100%",
  },
  captureHint: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  thumbs: { gap: space.sm, paddingRight: space.md },
  thumb: {
    width: 108,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    overflow: "hidden",
    paddingBottom: space.xs,
  },
  thumbSelected: { borderColor: colors.accent },
  thumbImage: {
    width: "100%",
    height: 140,
    backgroundColor: colors.chip,
  },
  thumbLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    paddingTop: 6,
  },
  ghost: {
    borderRadius: 12,
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  ghostLabel: { color: colors.text, fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.5 },
});
