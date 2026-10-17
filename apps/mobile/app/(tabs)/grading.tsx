import {
  canMarkSubmittedCopyReturned,
  canMovePurchasedCopyToSubmitted,
  gradingCopiesForUser,
  GRADING_TAB_CONSTRAINT,
  markSubmittedCopyReturned,
  movePurchasedCopyToSubmitted,
  parseStoredGradeEstimate,
  submittedStatusLabel,
  updateReturnedCopy,
  updateSubmittedCopy,
  type GradingReturnedCopy,
  type GradingSubmittedCopy,
  actionErrorMessage,
  SCREEN_EMPTY_COPY,
  SCREEN_ERROR_WHAT,
  SCREEN_LOADING_LABELS,
  screenDataState,
} from "@cardflow/shared";
import { InlineError, ScreenEmpty, ScreenError, ScreenLoading, StaleBanner } from "@/components/ui/screen-state";
import { StatusBanner } from "@/components/ui/status-banner";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PhotoGradeFlow } from "@/components/ui/photo-grade-flow";
import { PrepareSheet, type PrepareMovePayload } from "@/components/ui/prepare-sheet";
import { ReturnedSheet, type ReturnedSheetPayload } from "@/components/ui/returned-sheet";
import { SubmittedSheet, type SubmittedSheetSavePayload } from "@/components/ui/submitted-sheet";
import {
  listGrading,
  listInventory,
  markGradingReturned,
  patchGradingReturned,
  patchGradingSubmitted,
  submitGradingCopy,
  type InventoryItem,
} from "@/lib/api";
import { loadActiveIdentity, peekActiveUserId } from "@/lib/identity";
import { colors, radii, space } from "@/lib/theme";

function inventoryMaxBuyAmount(item: InventoryItem): string | null {
  return item.purchase?.maxBuy.maxBuyAmount ?? item.targetMaxBuyAmount ?? null;
}

function saveErrorMessage(caught: unknown): string {
  return actionErrorMessage(caught, "Couldn't save that change. Try again.");
}

type LoadState = "loading" | "ready" | "error";
type Segment = "prepare" | "submitted" | "returned";
type ReturnedSheetTarget =
  | { mode: "mark"; copy: GradingSubmittedCopy }
  | { mode: "edit"; copy: GradingReturnedCopy };

function matchesSearch(item: InventoryItem, query: string): boolean {
  if (!query) return true;
  const haystack = [item.card?.name, item.card?.setName, item.card?.localId]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export default function GradingScreen() {
  const [pane, setPane] = useState<"photo" | "pipeline">("photo");
  const [segment, setSegment] = useState<Segment>("prepare");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [activeUserId, setActiveUserId] = useState(peekActiveUserId);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<unknown>(null);
  // UX review P0-1/P0-2: inventory (Prepare) and grading (Submitted/Returned) load and fail
  // separately, and a failure after a good load keeps the data with a banner.
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [gradingState, setGradingState] = useState<LoadState>("loading");
  const [gradingError, setGradingError] = useState<unknown>(null);
  const [gradingLoadedAt, setGradingLoadedAt] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [query, setQuery] = useState("");
  const [preparingItem, setPreparingItem] = useState<InventoryItem | null>(null);
  const [submitted, setSubmitted] = useState<GradingSubmittedCopy[]>([]);
  const [returned, setReturned] = useState<GradingReturnedCopy[]>([]);
  const [returnedTarget, setReturnedTarget] = useState<ReturnedSheetTarget | null>(null);
  const [editingCopy, setEditingCopy] = useState<GradingSubmittedCopy | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshInventory = useCallback(async () => {
    const [identityResult, inventoryResult, gradingResult] = await Promise.allSettled([
      loadActiveIdentity(),
      listInventory(),
      listGrading(),
    ]);
    const identity = identityResult.status === "fulfilled" ? identityResult.value : null;
    const userId = identity?.userId ?? peekActiveUserId();
    setActiveUserId(userId);
    if (inventoryResult.status === "fulfilled") {
      const result = inventoryResult.value;
      const itemIds = new Set(result.items.map((item) => item.inventoryItemId));
      setItems(result.items);
      setPreparingItem((current) =>
        current && itemIds.has(current.inventoryItemId) ? current : null,
      );
      setLoadState("ready");
      setLoadError(null);
      setLoadedAt(Date.now());
    } else {
      setLoadError(inventoryResult.reason);
      setLoadState("error");
    }
    if (gradingResult.status === "fulfilled") {
      setSubmitted(gradingResult.value.submitted);
      setReturned(gradingResult.value.returned);
      setGradingState("ready");
      setGradingError(null);
      setGradingLoadedAt(Date.now());
    } else {
      // Keep the copies already on screen; never swap them for an empty list.
      setGradingError(gradingResult.reason);
      setGradingState("error");
    }
    setEditingCopy((current) => (current && current.userId === userId ? current : null));
    setReturnedTarget((current) =>
      current && current.copy.userId === userId ? current : null,
    );
  }, []);

  async function retryLoad() {
    if (retrying) return;
    setRetrying(true);
    if (loadedAt == null) setLoadState("loading");
    if (gradingLoadedAt == null) setGradingState("loading");
    try {
      await refreshInventory();
    } finally {
      setRetrying(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      void refreshInventory();
    }, [refreshInventory]),
  );

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSubmitted = useMemo(
    () => gradingCopiesForUser(submitted, activeUserId),
    [activeUserId, submitted],
  );
  const visibleReturned = useMemo(
    () => gradingCopiesForUser(returned, activeUserId),
    [activeUserId, returned],
  );
  const pipelineIds = useMemo(
    () =>
      new Set([
        ...visibleSubmitted.map((copy) => copy.inventoryItemId),
        ...visibleReturned.map((copy) => copy.inventoryItemId),
      ]),
    [visibleReturned, visibleSubmitted],
  );
  const purchasedItems = useMemo(
    () => items.filter((item) => item.intent === "purchased"),
    [items],
  );
  const prepareItems = useMemo(
    () => purchasedItems.filter((item) => !item.readOnly && !pipelineIds.has(item.inventoryItemId)),
    [pipelineIds, purchasedItems],
  );
  const visiblePurchased = useMemo(
    () => prepareItems.filter((item) => matchesSearch(item, normalizedQuery)),
    [normalizedQuery, prepareItems],
  );

  function openPrepare(item: InventoryItem) {
    if (!canMovePurchasedCopyToSubmitted(item.intent)) return;
    setPreparingItem(item);
  }

  function handleMoveToSubmitted(payload: PrepareMovePayload) {
    if (!preparingItem || !canMovePurchasedCopyToSubmitted(preparingItem.intent)) return;
    const userId = preparingItem.userId || activeUserId;
    if (!userId) return;
    const previousSubmitted = submitted;
    const previousSegment = segment;
    const previousPreparing = preparingItem;
    const input = {
      userId,
      intent: preparingItem.intent,
      inventoryItemId: preparingItem.inventoryItemId,
      name: preparingItem.card?.name ?? "Card",
      localId: preparingItem.card?.localId ?? null,
      imageUrl: preparingItem.card?.imageUrl ?? null,
      condition: payload.condition,
      pillarAnswers: payload.pillarAnswers,
      serviceLevelNote: payload.serviceLevelNote,
      maxBuyAmount: inventoryMaxBuyAmount(preparingItem),
      estimateJson: payload.estimateJson,
    };
    setActionError(null);
    setSubmitted((current) => movePurchasedCopyToSubmitted(current, input));
    setPreparingItem(null);
    setSegment("submitted");
    void submitGradingCopy(input)
      .then((result) => setSubmitted(result.submitted))
      .catch((caught) => {
        setSubmitted(previousSubmitted);
        setSegment(previousSegment);
        setPreparingItem(previousPreparing);
        setActionError(saveErrorMessage(caught));
      });
  }

  function handleReturnedSave(payload: ReturnedSheetPayload) {
    if (!returnedTarget) return;
    if (returnedTarget.mode === "mark") {
      if (!canMarkSubmittedCopyReturned(visibleSubmitted, returnedTarget.copy.inventoryItemId)) return;
      const previousSubmitted = submitted;
      const previousReturned = returned;
      const previousSegment = segment;
      const previousTarget = returnedTarget;
      const next = markSubmittedCopyReturned(submitted, returned, {
        inventoryItemId: returnedTarget.copy.inventoryItemId,
        certNumber: payload.certNumber,
        returnedGrade: payload.returnedGrade,
      });
      setActionError(null);
      setSubmitted(next.submitted);
      setReturned(next.returned);
      setReturnedTarget(null);
      setSegment("returned");
      void markGradingReturned({
        inventoryItemId: previousTarget.copy.inventoryItemId,
        certNumber: payload.certNumber,
        returnedGrade: payload.returnedGrade,
      })
        .then((result) => {
          setSubmitted(result.submitted);
          setReturned(result.returned);
        })
        .catch((caught) => {
          setSubmitted(previousSubmitted);
          setReturned(previousReturned);
          setSegment(previousSegment);
          setReturnedTarget(previousTarget);
          setActionError(saveErrorMessage(caught));
        });
      return;
    }
    const previousReturned = returned;
    const previousTarget = returnedTarget;
    const inventoryItemId = returnedTarget.copy.inventoryItemId;
    setActionError(null);
    setReturned((current) =>
      updateReturnedCopy(current, inventoryItemId, {
        certNumber: payload.certNumber,
        returnedGrade: payload.returnedGrade,
      }),
    );
    setReturnedTarget(null);
    void patchGradingReturned(inventoryItemId, {
      certNumber: payload.certNumber,
      returnedGrade: payload.returnedGrade,
    })
      .then((result) => setReturned(result.returned))
      .catch((caught) => {
        setReturned(previousReturned);
        setReturnedTarget(previousTarget);
        setActionError(saveErrorMessage(caught));
      });
  }

  function handleSaveSubmitted(payload: SubmittedSheetSavePayload) {
    if (!editingCopy) return;
    const previousSubmitted = submitted;
    const previousEditing = editingCopy;
    const inventoryItemId = editingCopy.inventoryItemId;
    setActionError(null);
    setSubmitted((current) => updateSubmittedCopy(current, inventoryItemId, payload));
    setEditingCopy(null);
    void patchGradingSubmitted(inventoryItemId, payload)
      .then((result) => setSubmitted(result.submitted))
      .catch((caught) => {
        setSubmitted(previousSubmitted);
        setEditingCopy(previousEditing);
        setActionError(saveErrorMessage(caught));
      });
  }

  function handleMarkReturnedFromSubmitted(payload: SubmittedSheetSavePayload) {
    if (!editingCopy) return;
    const updated = updateSubmittedCopy(submitted, editingCopy.inventoryItemId, payload);
    const copy = updated.find((item) => item.inventoryItemId === editingCopy.inventoryItemId);
    setSubmitted(updated);
    setEditingCopy(null);
    if (copy) setReturnedTarget({ mode: "mark", copy });
  }

  // Prepare reads inventory; Submitted and Returned read their own grading data.
  const onPrepare = segment === "prepare";
  const segmentLoadedAt = onPrepare ? loadedAt : gradingLoadedAt;
  const segmentError = onPrepare ? loadError : gradingError;
  const segmentData = screenDataState({ status: onPrepare ? loadState : gradingState, loadedAt: segmentLoadedAt });

  // The photo pre-grade pane never depends on the inventory load, so a load error can't
  // unmount it or drop its photos (UX review P0-2).
  if (pane === "photo") {
    return <PhotoGradeFlow onOpenPipeline={() => setPane("pipeline")} />;
  }

  return (
    <View style={styles.flex}>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityLabel="Photo grade"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => setPane("photo")}
        >
          <Text style={styles.photoLink}>Photo grade</Text>
        </Pressable>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Grading</Text>
          {segment === "prepare" ? (
            <View style={styles.searchBox}>
              <Ionicons color={colors.muted} name="search-outline" size={18} />
              <TextInput
                accessibilityLabel="Search purchased copies"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setQuery}
                placeholder="Search"
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
                value={query}
              />
            </View>
          ) : null}
        </View>
        <StatusBanner />
        <Text style={styles.constraint}>{GRADING_TAB_CONSTRAINT}</Text>
        <View accessibilityRole="tablist" style={styles.segments}>
          <SegmentButton
            label="Prepare"
            onPress={() => setSegment("prepare")}
            selected={segment === "prepare"}
          />
          <SegmentButton
            label="Submitted"
            onPress={() => setSegment("submitted")}
            selected={segment === "submitted"}
          />
          <SegmentButton
            label="Returned"
            onPress={() => setSegment("returned")}
            selected={segment === "returned"}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        style={styles.flex}
      >
        <InlineError message={actionError} />
        {segmentData === "stale" && segmentLoadedAt != null ? (
          <StaleBanner loadedAt={segmentLoadedAt} onRetry={() => void retryLoad()} retrying={retrying} />
        ) : null}
        {segment === "prepare" ? (
          <Pressable accessibilityLabel="Batch pre-grade" accessibilityRole="button" onPress={() => router.push("/grade-batch")}>
            <Text style={styles.batchLink}>Batch pre-grade</Text>
          </Pressable>
        ) : null}
        {segmentData === "error" ? (
          <ScreenError
            error={segmentError}
            onRetry={() => void retryLoad()}
            retrying={retrying}
            what={SCREEN_ERROR_WHAT.grade}
          />
        ) : segmentData === "loading" ? (
          <ScreenLoading label={SCREEN_LOADING_LABELS.grade} rows={4} />
        ) : segment === "prepare" ? (
          visiblePurchased.length === 0 ? (
            <EmptyState
              onOpenCollection={() => router.push("/(tabs)/collection")}
              hasQuery={Boolean(normalizedQuery)}
              hasPurchased={purchasedItems.length > 0}
              hasPrepareRemaining={prepareItems.length > 0}
              segment="prepare"
            />
          ) : (
            visiblePurchased.map((item) => (
              <PrepareRow
                item={item}
                key={item.inventoryItemId}
                onPrepare={() => openPrepare(item)}
              />
            ))
          )
        ) : segment === "submitted" ? (
          visibleSubmitted.length === 0 ? (
            <EmptyState segment="submitted" />
          ) : (
            visibleSubmitted.map((copy) => (
              <SubmittedRow
                copy={copy}
                key={copy.inventoryItemId}
                onPress={() => setEditingCopy(copy)}
              />
            ))
          )
        ) : visibleReturned.length === 0 ? (
          <EmptyState segment="returned" />
        ) : (
          visibleReturned.map((copy) => (
            <ReturnedRow
              copy={copy}
              key={copy.inventoryItemId}
              onPress={() => setReturnedTarget({ mode: "edit", copy })}
            />
          ))
        )}
      </ScrollView>

      <PrepareSheet
        canSubmit={
          preparingItem != null && canMovePurchasedCopyToSubmitted(preparingItem.intent)
        }
        hasStoredBack={Boolean(preparingItem?.gradePhotos?.back)}
        hasStoredFront={Boolean(preparingItem?.gradePhotos?.front)}
        imageStorageRef={preparingItem?.imageStorageRef ?? null}
        imageUrl={preparingItem?.card?.imageUrl ?? null}
        itemId={preparingItem?.inventoryItemId ?? null}
        key={preparingItem?.inventoryItemId ?? "prepare-closed"}
        maxBuyAmount={preparingItem ? inventoryMaxBuyAmount(preparingItem) : null}
        name={preparingItem?.card?.name ?? "Card"}
        onClose={() => {
          setPreparingItem(null);
          void refreshInventory();
        }}
        onMoveToSubmitted={handleMoveToSubmitted}
        scanId={preparingItem?.scanId ?? null}
        seedCondition={preparingItem?.condition ?? null}
        tcgdexId={preparingItem?.card?.tcgdexId ?? null}
        visible={preparingItem != null}
      />
      <SubmittedSheet
        copy={editingCopy}
        onClose={() => setEditingCopy(null)}
        onMarkReturned={handleMarkReturnedFromSubmitted}
        onSave={handleSaveSubmitted}
        visible={editingCopy != null}
      />
      <ReturnedSheet
        imageUrl={returnedTarget?.copy.imageUrl ?? null}
        localId={returnedTarget?.copy.localId ?? null}
        mode={returnedTarget?.mode ?? "mark"}
        name={returnedTarget?.copy.name ?? "Card"}
        onClose={() => setReturnedTarget(null)}
        onSave={handleReturnedSave}
        seedCertNumber={returnedTarget?.mode === "edit" ? returnedTarget.copy.certNumber : ""}
        seedReturnedGrade={
          returnedTarget?.mode === "edit" ? returnedTarget.copy.returnedGrade : ""
        }
        visible={returnedTarget != null}
      />
    </View>
  );
}

interface SegmentButtonProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

function SegmentButton({ label, selected, onPress }: SegmentButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.segment, selected && styles.segmentSelected]}
    >
      <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

interface EmptyStateProps {
  segment: Segment;
  hasQuery?: boolean;
  hasPurchased?: boolean;
  hasPrepareRemaining?: boolean;
  onOpenCollection?: () => void;
}

function EmptyState({
  segment,
  hasQuery = false,
  hasPurchased = false,
  hasPrepareRemaining = false,
  onOpenCollection,
}: EmptyStateProps) {
  const c = SCREEN_EMPTY_COPY;
  if (segment === "submitted") {
    return <ScreenEmpty body={c.gradeSubmitted.body} icon="paper-plane-outline" title={c.gradeSubmitted.title} />;
  }
  if (segment === "returned") {
    return <ScreenEmpty body={c.gradeReturned.body} icon="return-down-back-outline" title={c.gradeReturned.title} />;
  }
  if (hasQuery && hasPrepareRemaining) {
    return <ScreenEmpty body={c.noMatches.body} icon="search-outline" title={c.noMatches.title} />;
  }
  if (hasPurchased && !hasPrepareRemaining) {
    return <ScreenEmpty body={c.gradePrepareDone.body} icon="checkmark-done-outline" title={c.gradePrepareDone.title} />;
  }
  return (
    <ScreenEmpty
      action={onOpenCollection ? { label: c.gradePrepare.action, onPress: onOpenCollection } : undefined}
      body={c.gradePrepare.body}
      title={c.gradePrepare.title}
    />
  );
}

interface PrepareRowProps {
  item: InventoryItem;
  onPrepare: () => void;
}

function PrepareRow({ item, onPrepare }: PrepareRowProps) {
  const name = item.card?.name ?? "Card";
  const localId = item.card?.localId;
  const numberLabel = localId ? `#${localId}` : null;
  const allIn = item.purchase?.costBasis.allInTotal;
  const condition = item.condition?.trim() || null;
  const imageUrl = item.card?.imageUrl ?? null;
  const statusLine = condition ? `${condition} · purchased` : "purchased";

  return (
    <View
      accessibilityLabel={[
        name,
        numberLabel,
        allIn ? `all-in $${allIn}` : null,
        statusLine,
        "Prepare",
      ]
        .filter(Boolean)
        .join(", ")}
      style={styles.row}
    >
      {imageUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          contentFit="cover"
          source={{ uri: imageUrl }}
          style={styles.thumb}
        />
      ) : (
        <View style={styles.thumbSlot} />
      )}
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {numberLabel ? `${name} ${numberLabel}` : name}
        </Text>
        {allIn ? <Text style={styles.rowMeta}>all-in ${allIn}</Text> : null}
        <Text style={styles.rowMeta}>{statusLine}</Text>
        <Pressable
          accessibilityLabel={`Prepare ${name}`}
          accessibilityRole="button"
          onPress={onPrepare}
          style={styles.prepareCta}
        >
          <Text style={styles.prepareCtaLabel}>Prepare</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface SubmittedRowProps {
  copy: GradingSubmittedCopy;
  onPress: () => void;
}

function SubmittedRow({ copy, onPress }: SubmittedRowProps) {
  const numberLabel = copy.localId ? `#${copy.localId}` : null;
  const imageUrl = copy.imageUrl;
  const orderLine = copy.orderNumber ? `Order ${copy.orderNumber}` : "No order #";
  const companyLine = copy.company || null;
  const statusLabel = submittedStatusLabel(copy.status);
  const guidance = parseStoredGradeEstimate(copy.estimateJson);
  const estimateNote = guidance?.overall == null ? null : guidance.display;

  return (
    <Pressable
      accessibilityLabel={[copy.name, numberLabel, orderLine, companyLine, estimateNote, statusLabel]
        .filter(Boolean)
        .join(", ")}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.row}
    >
      {imageUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          contentFit="cover"
          source={{ uri: imageUrl }}
          style={styles.thumb}
        />
      ) : (
        <View style={styles.thumbSlot} />
      )}
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {numberLabel ? `${copy.name} ${numberLabel}` : copy.name}
        </Text>
        <Text style={styles.rowMeta}>{orderLine}</Text>
        {companyLine ? <Text style={styles.rowMeta}>{companyLine}</Text> : null}
        {estimateNote ? <Text style={styles.rowMeta}>{estimateNote}</Text> : null}
        <View style={styles.statusChip}>
          <Text style={styles.statusChipLabel}>{statusLabel}</Text>
        </View>
      </View>
    </Pressable>
  );
}

interface ReturnedRowProps {
  copy: GradingReturnedCopy;
  onPress: () => void;
}

function ReturnedRow({ copy, onPress }: ReturnedRowProps) {
  const numberLabel = copy.localId ? `#${copy.localId}` : null;
  const imageUrl = copy.imageUrl;
  const certLine = copy.certNumber ? `cert ${copy.certNumber}` : "no cert #";
  const gradeLine = copy.returnedGrade || "no returned grade";

  return (
    <Pressable
      accessibilityLabel={[copy.name, numberLabel, certLine, gradeLine]
        .filter(Boolean)
        .join(", ")}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.row}
    >
      {imageUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          contentFit="cover"
          source={{ uri: imageUrl }}
          style={styles.thumb}
        />
      ) : (
        <View style={styles.thumbSlot} />
      )}
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {numberLabel ? `${copy.name} ${numberLabel}` : copy.name}
        </Text>
        <Text style={styles.rowMeta}>{certLine}</Text>
        <Text style={styles.rowMeta}>{gradeLine}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  batchLink: { color: colors.accent, fontWeight: "700", fontSize: 15 },
  flex: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    gap: space.md,
  },
  content: { padding: space.lg, gap: space.md, paddingBottom: 48 },
  error: { color: colors.danger, fontSize: 14 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingHorizontal: space.sm,
    minHeight: 40,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 8,
  },
  photoLink: { color: colors.accent, fontSize: 15, fontWeight: "700" },
  constraint: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  segments: {
    flexDirection: "row",
    backgroundColor: colors.chip,
    borderRadius: radii.pill,
    padding: 3,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    borderRadius: radii.pill,
    paddingVertical: 8,
  },
  segmentSelected: { backgroundColor: colors.accent },
  segmentLabel: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  segmentLabelSelected: { color: colors.accentText },
  empty: { gap: space.sm },
  emptyTitle: { color: colors.text, fontSize: 22, fontWeight: "800" },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  row: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingRight: space.md,
  },
  thumb: {
    width: 72,
    aspectRatio: 0.715,
    backgroundColor: colors.chip,
  },
  thumbSlot: {
    width: 72,
    aspectRatio: 0.715,
    backgroundColor: colors.chip,
  },
  rowCopy: { flex: 1, paddingVertical: space.sm, gap: 2 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  rowMeta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  prepareCta: {
    alignSelf: "flex-start",
    backgroundColor: colors.cta,
    borderRadius: radii.pill,
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: space.sm,
  },
  prepareCtaLabel: {
    color: colors.ctaText,
    fontSize: 13,
    fontWeight: "700",
  },
  statusChip: {
    alignSelf: "flex-start",
    backgroundColor: colors.chip,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 999,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusChipLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
  },
});
