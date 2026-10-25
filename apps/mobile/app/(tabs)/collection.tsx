import Ionicons from "@expo/vector-icons/Ionicons";
import { TcgplayerAttribution } from "@/components/ui/tcgplayer-attribution";
import { StatusBanner } from "@/components/ui/status-banner";
import { SyncPending } from "@/components/ui/sync-pending";
import { ScanQueueList } from "@/components/ui/scan-queue-list";
import { cancelQueuedWrite, isQueuedId, runQueueableWrite } from "@/lib/write-queue";
import { requireAccount } from "@/lib/signup-prompt";
import {
  collectionTileValue,
  DETAILS_NEEDED_LABEL,
  isDetailsNeededPurchase,
  isOpenWatchlist,
  PURCHASED_UNDO_TOAST_MS,
  shouldAcceptLiveHudPurchaseTap,
  type CardFlowPortfolioSummary,
  type MaxBuyPreferences,
  type TcgdexVariants,
  actionErrorMessage,
  purchasedFailureMessage,
  screenDataState,
  SCREEN_EMPTY_COPY,
  SCREEN_ERROR_WHAT,
  SCREEN_LOADING_LABELS,
} from "@cardflow/shared";
import { InlineError, ScreenEmpty, ScreenError, ScreenLoading, StaleBanner } from "@/components/ui/screen-state";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { CardTile } from "@/components/ui/card-tile";
import {
  playPurchasedSuccessHaptic,
  PurchasedUndoToast,
} from "@/components/ui/hud-bubble";
import { PurchaseSheet, type PurchaseSavePayload } from "@/components/ui/purchase-sheet";
import { ValueHistoryChart } from "@/components/ui/value-history-chart";
import {
  isWatchlistDraftBlockedError,
  getPortfolio,
  getPortfolioHistory,
  type PortfolioHistoryPoint,
  completePurchasedDetails,
  listInventory,
  openOrCreateDraft,
  undoPurchased,
  type InventoryItem,
} from "@/lib/api";
import { loadMaxBuyPreferences, peekMaxBuyPreferences } from "@/lib/preferences";
import { colors, radii, space, type } from "@/lib/theme";

type LoadState = "loading" | "ready" | "error";
type Segment = "purchased" | "watchlist";

function parseSegment(value: string | string[] | undefined): Segment | null {
  const raw = firstParam(value);
  if (raw === "watchlist" || raw === "purchased") return raw;
  return null;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function collectionColumnCount(width: number): number {
  if (width >= 1200) return 6;
  if (width >= 900) return 5;
  if (width >= 700) return 4;
  return 3;
}

function matchesSearch(item: InventoryItem, query: string): boolean {
  if (!query) return true;
  const haystack = [item.card?.name, item.card?.setName, item.card?.localId]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export default function CollectionScreen() {
  const router = useRouter();
    const openScan = () => {
    if (requireAccount()) router.push("/capture");
  };
  const { width } = useWindowDimensions();
  const columns = collectionColumnCount(width);
  const gridGap = space.sm;
  const gridItemWidth = Math.floor(
    (width - space.lg * 2 - gridGap * (columns - 1)) / columns,
  );
  const params = useLocalSearchParams<{
    segment?: string | string[];
    purchasedUndoId?: string | string[];
  }>();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [portfolio, setPortfolio] = useState<CardFlowPortfolioSummary | null>(null);
  const [history, setHistory] = useState<{ points: PortfolioHistoryPoint[]; today: string | null }>({
    points: [],
    today: null,
  });
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<unknown>(null);
  // UX review P0-1: when the last good load was, so a later failure keeps the data.
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [segment, setSegment] = useState<Segment>(
    () => parseSegment(params.segment) ?? "purchased",
  );
  const [query, setQuery] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [detailsNeededOnly, setDetailsNeededOnly] = useState(false);
  const [detailItem, setDetailItem] = useState<InventoryItem | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [preferences, setPreferences] = useState<MaxBuyPreferences>(peekMaxBuyPreferences);
  const [undoing, setUndoing] = useState(false);
  const [savingWatchlistId, setSavingWatchlistId] = useState<string | null>(null);
  const savingWatchlistIdRef = useRef<string | null>(null);
  const toastItemId = firstParam(params.purchasedUndoId) ?? null;

  const refreshInventory = useCallback(async () => {
    try {
      const [result, portfolioResult] = await Promise.all([
        listInventory(),
        getPortfolio().catch(() => null),
      ]);
      setItems(result.items);
      setPortfolio(portfolioResult?.portfolio ?? null);
      setLoadState("ready");
      setLoadError(null);
      setLoadedAt(Date.now());
    } catch (caught) {
      setLoadError(caught);
      setLoadState("error");
    }
    // After /v1/portfolio so today's recorded snapshot is included.
    try {
      const historyResult = await getPortfolioHistory("all");
      setHistory({ points: historyResult.points, today: historyResult.today });
    } catch {
      // Keep the last loaded history; the chart falls back to the current estimate.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const requested = parseSegment(params.segment);
      if (requested) setSegment(requested);
      setPreferences(peekMaxBuyPreferences());
      void loadMaxBuyPreferences()
        .then((next) => setPreferences(next))
        .catch(() => setPreferences(peekMaxBuyPreferences()));
      void refreshInventory();
    }, [params.segment, refreshInventory]),
  );

  const dataState = screenDataState({ status: loadState, loadedAt });

  async function retryLoad() {
    if (retrying) return;
    setRetrying(true);
    if (loadedAt == null) setLoadState("loading");
    try {
      await refreshInventory();
    } finally {
      setRetrying(false);
    }
  }

  function selectSegment(next: Segment) {
    setSegment(next);
    router.setParams({ segment: next });
  }

  const normalizedQuery = query.trim().toLowerCase();
  const purchasedCount = useMemo(
    () => items.filter((item) => item.intent === "purchased").length,
    [items],
  );
  const detailsNeededCount = useMemo(
    () => items.filter((item) => isDetailsNeededPurchase(item)).length,
    [items],
  );
  const watchingCount = useMemo(
    () => items.filter((item) => isOpenWatchlist(item)).length,
    [items],
  );
  const segmentedItems = useMemo(
    () =>
      items.filter((item) =>
        segment === "watchlist" ? isOpenWatchlist(item) : item.intent === segment,
      ),
    [items, segment],
  );
  const visibleItems = useMemo(
    () =>
      segmentedItems.filter((item) => {
        if (!matchesSearch(item, normalizedQuery)) return false;
        if (segment === "purchased" && detailsNeededOnly) {
          return isDetailsNeededPurchase(item);
        }
        return true;
      }),
    [detailsNeededOnly, normalizedQuery, segment, segmentedItems],
  );

  useEffect(() => {
    if (!toastItemId) return;
    AccessibilityInfo.announceForAccessibility("Marked Purchased. Undo is available.");
    const timer = setTimeout(() => {
      router.setParams({ purchasedUndoId: undefined });
    }, PURCHASED_UNDO_TOAST_MS);
    return () => clearTimeout(timer);
  }, [router, toastItemId]);

  function openWatchlistDetail(item: InventoryItem) {
    router.push({
      pathname: "/decide/[cardflowCardId]",
      params: {
        cardflowCardId: item.cardflowCardId,
        intent: "watchlist",
        inventoryItemId: item.inventoryItemId,
        ...(item.selectedVariant ? { selectedVariant: item.selectedVariant } : {}),
        ...(item.referencePriceAmount
          ? { referencePriceAmount: item.referencePriceAmount }
          : {}),
        ...(item.targetMaxBuyAmount ? { targetMaxBuyAmount: item.targetMaxBuyAmount } : {}),
        ...(item.condition ? { condition: item.condition } : {}),
      },
    });
  }

  function openPurchasedItem(item: InventoryItem) {
    if (isDetailsNeededPurchase(item)) {
      setDetailError(null);
      setDetailItem(item);
      return;
    }
    void openDraft(item);
  }

  async function savePurchaseDetails(payload: PurchaseSavePayload) {
    if (!detailItem) return;
    setIsSavingDetails(true);
    setDetailError(null);
    try {
      await completePurchasedDetails(detailItem.inventoryItemId, {
        purchasePrice: payload.purchasePrice,
        purchasedAt: payload.purchasedAt,
        shipping: payload.shipping ?? "0.00",
        tax: payload.tax ?? "0.00",
        fees: payload.fees ?? "0.00",
        supplies: payload.supplies ?? "0.00",
        condition: payload.condition,
        selectedVariant: payload.selectedVariant,
      });
      setDetailItem(null);
      await refreshInventory();
    } catch (caught) {
      setDetailError(actionErrorMessage(caught, "Couldn't save purchase details. Try again."));
    } finally {
      setIsSavingDetails(false);
    }
  }

  async function openDraft(item: InventoryItem) {
    setActionError(null);
    if (item.intent !== "purchased") {
      openWatchlistDetail(item);
      return;
    }
    try {
      const result = await openOrCreateDraft(item.inventoryItemId);
      router.push(`/draft/${result.draft.draftId}`);
    } catch (caught) {
      if (isWatchlistDraftBlockedError(caught)) {
        openWatchlistDetail(item);
        return;
      }
      setActionError(actionErrorMessage(caught, "Couldn't open the draft. Try again."));
    }
  }

  async function onWatchlistPurchased(item: InventoryItem) {
    // Community review 4: duplicate guard. One save per card at a time, and never re-save a
    // copy that's already Purchased.
    if (item.intent === "purchased") return;
    if (
      !shouldAcceptLiveHudPurchaseTap({
        matchKey: item.inventoryItemId,
        inFlightKey: savingWatchlistIdRef.current,
      })
    ) {
      return;
    }
    savingWatchlistIdRef.current = item.inventoryItemId;
    setSavingWatchlistId(item.inventoryItemId);
    setActionError(null);
    try {
      const saved = await runQueueableWrite("watchlist_to_purchased", {
        inventoryItemId: item.inventoryItemId,
      });
      await playPurchasedSuccessHaptic();
      setSegment("purchased");
      router.setParams({
        segment: "purchased",
        purchasedUndoId: saved.queued ? saved.queuedId : saved.result.item.inventoryItemId,
      });
      await refreshInventory();
    } catch (caught) {
      setActionError(purchasedFailureMessage(caught));
    } finally {
      savingWatchlistIdRef.current = null;
      setSavingWatchlistId(null);
    }
  }

  async function onUndoPurchased() {
    if (!toastItemId || undoing) return;
    setUndoing(true);
    setActionError(null);
    try {
      if (isQueuedId(toastItemId)) cancelQueuedWrite(toastItemId);
      else await undoPurchased(toastItemId);
      router.setParams({ purchasedUndoId: undefined });
      AccessibilityInfo.announceForAccessibility("Purchased undone");
      await refreshInventory();
    } catch (caught) {
      setActionError(actionErrorMessage(caught, "Couldn't undo. Try again."));
    } finally {
      setUndoing(false);
    }
  }

  return (
    <View style={styles.flex}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarHeader}>
          <View style={styles.searchBox}>
            <Ionicons color={colors.muted} name="search" size={16} />
            <TextInput
              accessibilityLabel="Search MyDEX"
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              onChangeText={setQuery}
              placeholder="Search cards"
              placeholderTextColor={colors.muted}
              style={styles.searchInput}
              value={query}
            />
          </View>
          
          <View style={styles.headerButtons}>
            {segment === "purchased" && purchasedCount > 0 ? (
              <Pressable
                accessibilityLabel="Export CSV"
                accessibilityRole="button"
                onPress={() => router.push("/collection-export")}
                style={styles.iconButton}
              >
                <Ionicons color={colors.text} name="share-outline" size={22} />
              </Pressable>
            ) : null}
            
            {segment === "purchased" ? (
              <Pressable
                accessibilityLabel="P&L"
                accessibilityRole="button"
                onPress={() => router.push("/pnl")}
                style={styles.iconButton}
              >
                <Ionicons color={colors.text} name="analytics-outline" size={22} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <View accessibilityRole="tablist" style={styles.segments}>
          <SegmentButton
            label="Purchased"
            onPress={() => selectSegment("purchased")}
            selected={segment === "purchased"}
          />
          <SegmentButton
            label="Watchlist"
            onPress={() => selectSegment("watchlist")}
            selected={segment === "watchlist"}
          />
        </View>

        {loadedAt != null ? (
          <Text
            accessibilityLabel={`${purchasedCount} purchased, ${detailsNeededCount} details needed, ${watchingCount} watching`}
            style={styles.counts}
          >
            {purchasedCount} owned
            {detailsNeededCount > 0 ? ` · ${detailsNeededCount} details needed` : ""}
            {" · "}
            {watchingCount} watching
          </Text>
        ) : null}

        <Pressable
          accessibilityLabel="MyDEX by set"
          accessibilityRole="button"
          onPress={() => router.push("/dex")}
          style={styles.dexLink}
        >
          <Ionicons color={colors.text} name="grid-outline" size={16} />
          <Text style={styles.dexLinkText}>MyDEX by set</Text>
        </Pressable>

        {segment === "purchased" && detailsNeededCount > 0 ? (
          <Pressable
            accessibilityLabel={DETAILS_NEEDED_LABEL}
            accessibilityRole="button"
            accessibilityState={{ selected: detailsNeededOnly }}
            onPress={() => setDetailsNeededOnly((current) => !current)}
            style={[styles.filterChip, detailsNeededOnly && styles.filterChipSelected]}
          >
            <Text style={[styles.filterChipLabel, detailsNeededOnly && styles.filterChipLabelSelected]}>
              {DETAILS_NEEDED_LABEL}
              {detailsNeededCount > 0 ? ` ${detailsNeededCount}` : ""}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityLabel="Scan a card"
          accessibilityRole="button"
          onPress={openScan}
          style={styles.scanner}
        >
          <Ionicons color={colors.accentText} name="camera" size={16} />
          <Text style={styles.scannerTitle}>Scan a card</Text>
        </Pressable>
      </View>

      {dataState === "error" ? (
        <View style={styles.bodyPad}>
          <ScreenError
            error={loadError}
            onRetry={() => void retryLoad()}
            retrying={retrying}
            what={SCREEN_ERROR_WHAT.collection}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          style={styles.flex}
        >
          {dataState === "stale" && loadedAt != null ? (
            <StaleBanner kind="prices" loadedAt={loadedAt} onRetry={() => void retryLoad()} retrying={retrying} />
          ) : null}
          {segment === "purchased" && loadedAt != null ? (
            <ValueHistoryChart
              currentCents={portfolio?.amountCents ?? null}
              currentDisplay={portfolio ? portfolio.display : null}
              disclaimer={portfolio?.disclaimer ?? null}
              points={history.points}
              today={history.today}
            />
          ) : null}
          {segment === "purchased" && loadedAt != null && portfolio?.amountCents ? <TcgplayerAttribution /> : null}
          <SyncPending />
          <ScanQueueList />
          <StatusBanner />
          <InlineError message={actionError} />
          {dataState === "loading" ? (
            <ScreenLoading
              label={SCREEN_LOADING_LABELS.collection}
              rows={4}
              tileWidth={gridItemWidth}
              variant={segment === "purchased" ? "collection" : "grid"}
            />
          ) : visibleItems.length === 0 ? (
            <EmptyState
              onScan={openScan}
              hasQuery={Boolean(normalizedQuery) || (segment === "purchased" && detailsNeededOnly)}
              hasSegmentItems={segmentedItems.length > 0}
              segment={segment}
            />
          ) : (
            <View style={styles.grid}>
              {visibleItems.map((item) => {
                const detailsNeeded = isDetailsNeededPurchase(item);
                const tileValue = collectionTileValue(
                  {
                    intent: item.intent,
                    workflowState: item.workflowState,
                    allInTotal: item.purchase?.costBasis.allInTotal ?? null,
                    referencePriceAmount: item.referencePriceAmount,
                    targetMaxBuyAmount: item.targetMaxBuyAmount,
                    condition: item.condition,
                    purchase: item.purchase,
                  },
                  preferences,
                );
                const canConvertWatchlist =
                  isOpenWatchlist(item) && !item.readOnly;
                return (
                  <View key={item.inventoryItemId} style={[styles.gridItem, { width: gridItemWidth }]}>
                    <CardTile
                      allInAmount={tileValue.allInAmount}
                      detailsNeeded={detailsNeeded}
                      hasDraft={Boolean(item.draft)}
                      imageUrl={item.card?.imageUrl ?? null}
                      intent={item.intent}
                      language={(item.card?.language ?? "EN").toUpperCase()}
                      localId={item.card?.localId}
                      name={item.card?.name}
                      onPress={
                        item.readOnly
                          ? undefined
                          : item.intent === "purchased"
                            ? () => openPurchasedItem(item)
                            : () => openWatchlistDetail(item)
                      }
                      showDraftCta={item.intent === "purchased" && !item.readOnly && !detailsNeeded}
                      targetMaxBuyDisplay={tileValue.targetMaxBuyDisplay}
                    />
                    {canConvertWatchlist ? (
                      <Pressable
                        accessibilityHint="Marks this Watchlist card Purchased without scanning again"
                        accessibilityLabel="Purchased"
                        accessibilityRole="button"
                        accessibilityState={{
                          disabled: savingWatchlistId === item.inventoryItemId,
                          busy: savingWatchlistId === item.inventoryItemId,
                        }}
                        disabled={savingWatchlistId === item.inventoryItemId}
                        onPress={() => void onWatchlistPurchased(item)}
                        style={styles.purchasedTap}
                      >
                        <Text style={styles.purchasedTapLabel}>
                          {savingWatchlistId === item.inventoryItemId ? "Saving…" : "Purchased"}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
      <PurchaseSheet
        error={detailError}
        initialPurchasePrice=""
        isSaving={isSavingDetails}
        localId={detailItem?.card?.localId ?? ""}
        name={detailItem?.card?.name ?? "Card"}
        onClose={() => {
          if (!isSavingDetails) setDetailItem(null);
        }}
        onSave={(payload) => void savePurchaseDetails(payload)}
        selectedVariant={detailItem?.selectedVariant ?? "normal"}
        setName={detailItem?.card?.setName ?? ""}
        variants={COLLECTION_PURCHASE_VARIANTS}
        visible={detailItem !== null}
      />
      {toastItemId ? (
        <View style={styles.toastWrap}>
          <PurchasedUndoToast onUndo={() => void onUndoPurchased()} undoing={undoing} />
        </View>
      ) : null}
    </View>
  );
}

const COLLECTION_PURCHASE_VARIANTS: TcgdexVariants = {
  normal: true,
  holo: true,
  reverse: true,
  firstEdition: false,
  wPromo: false,
};

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
      <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

interface EmptyStateProps {
  segment: Segment;
  hasQuery: boolean;
  hasSegmentItems: boolean;
  onScan: () => void;
}

function EmptyState({ segment, hasQuery, hasSegmentItems, onScan }: EmptyStateProps) {
  if (hasQuery && hasSegmentItems) {
    return <ScreenEmpty body={SCREEN_EMPTY_COPY.noMatches.body} icon="search-outline" title={SCREEN_EMPTY_COPY.noMatches.title} />;
  }
  if (segment === "watchlist") {
    return (
      <ScreenEmpty
        action={{ label: SCREEN_EMPTY_COPY.collectionWatchlist.action, onPress: onScan }}
        body={SCREEN_EMPTY_COPY.collectionWatchlist.body}
        icon="eye-outline"
        title={SCREEN_EMPTY_COPY.collectionWatchlist.title}
      />
    );
  }
  return (
    <ScreenEmpty
      action={{ label: SCREEN_EMPTY_COPY.collectionPurchased.action, onPress: onScan }}
      body={SCREEN_EMPTY_COPY.collectionPurchased.body}
      title={SCREEN_EMPTY_COPY.collectionPurchased.title}
    />
  );
}

const styles = StyleSheet.create({
  dexLink: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
  dexLinkText: { color: colors.text, fontSize: 14 },
  flex: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    gap: space.sm,
  },
  bodyPad: { padding: space.lg, gap: space.md },
  content: { padding: space.lg, gap: space.md, paddingBottom: 48 },
  scanner: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  scannerTitle: { color: colors.accentText, fontSize: 13, fontWeight: "800" },
  counts: { color: colors.muted, ...type.caption },
  searchBox: {
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
  segmentLabel: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  segmentLabelSelected: { color: colors.accentText },
  title: { color: colors.text, ...type.title },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  empty: { gap: space.sm },
  error: { color: colors.danger, fontSize: 14 },
  filterChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    backgroundColor: colors.chip,
  },
  filterChipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.card,
  },
  filterChipLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
  },
  filterChipLabelSelected: {
    color: colors.text,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
  },
  gridItem: {
    flexGrow: 0,
    flexShrink: 0,
  },
  purchasedTap: {
    marginTop: 6,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    paddingHorizontal: space.sm,
  },
  purchasedTapLabel: {
    color: colors.accentText,
    fontSize: 13,
    fontWeight: "800",
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: space.md,
  },
  toolbarHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  headerButtons: {
    flexDirection: "row",
    gap: space.xs,
  },
  iconButton: {
    padding: space.xs,
  },
});
