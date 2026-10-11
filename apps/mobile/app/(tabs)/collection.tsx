import Ionicons from "@expo/vector-icons/Ionicons";
import {
  collectionTileValue,
  DETAILS_NEEDED_LABEL,
  isDetailsNeededPurchase,
  type CardFlowPortfolioSummary,
  type MaxBuyPreferences,
  type TcgdexVariants,
} from "@cardflow/shared";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { CardTile } from "@/components/ui/card-tile";
import { PrimaryButton } from "@/components/ui/primary-button";
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
  type InventoryItem,
} from "@/lib/api";
import { loadMaxBuyPreferences, peekMaxBuyPreferences } from "@/lib/preferences";
import { colors, space } from "@/lib/theme";

type LoadState = "loading" | "ready" | "error";
type Segment = "purchased" | "watchlist";

function parseSegment(value: string | string[] | undefined): Segment | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "watchlist" || raw === "purchased") return raw;
  return null;
}

function collectionColumnCount(width: number): number {
  if (width >= 1200) return 5;
  if (width >= 900) return 4;
  if (width >= 640) return 3;
  return 2;
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
  const { width } = useWindowDimensions();
  const columns = collectionColumnCount(width);
  const gridGap = space.sm;
  const gridItemWidth = Math.floor(
    (width - space.lg * 2 - gridGap * (columns - 1)) / columns,
  );
  const params = useLocalSearchParams<{ segment?: string | string[] }>();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [portfolio, setPortfolio] = useState<CardFlowPortfolioSummary | null>(null);
  const [history, setHistory] = useState<{ points: PortfolioHistoryPoint[]; today: string | null }>({
    points: [],
    today: null,
  });
  const [loadState, setLoadState] = useState<LoadState>("loading");
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

  const refreshInventory = useCallback(async () => {
    try {
      const [result, portfolioResult] = await Promise.all([
        listInventory(),
        getPortfolio().catch(() => null),
      ]);
      setItems(result.items);
      setPortfolio(portfolioResult?.portfolio ?? null);
      setLoadState("ready");
    } catch {
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
    () => items.filter((item) => item.intent === "watchlist").length,
    [items],
  );
  const segmentedItems = useMemo(
    () => items.filter((item) => item.intent === segment),
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

  function openWatchlistDetail(item: InventoryItem) {
    router.push({
      pathname: "/decide/[cardflowCardId]",
      params: {
        cardflowCardId: item.cardflowCardId,
        intent: "watchlist",
        ...(item.referencePriceAmount
          ? { referencePriceAmount: item.referencePriceAmount }
          : {}),
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
      setDetailError(caught instanceof Error ? caught.message : "Could not save purchase details");
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
      setActionError(caught instanceof Error ? caught.message : "Could not open draft");
    }
  }

  return (
    <View style={styles.flex}>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityLabel="Scan a card"
          accessibilityRole="button"
          onPress={() => router.push("/capture")}
          style={styles.scanner}
        >
          <View style={styles.scannerIcon}>
            <Ionicons color={colors.ctaText} name="camera" size={26} />
          </View>
          <View style={styles.scannerCopy}>
            <Text style={styles.scannerTitle}>Scan a card</Text>
            <Text style={styles.scannerMeta}>
              Still photo of one English raw single.
            </Text>
          </View>
          <Ionicons color={colors.muted} name="chevron-forward" size={20} />
        </Pressable>

        {loadState === "ready" ? (
          <Text
            accessibilityLabel={`${purchasedCount} purchased, ${detailsNeededCount} details needed, ${watchingCount} watching`}
            style={styles.counts}
          >
            {purchasedCount} purchased
            {detailsNeededCount > 0 ? ` · ${detailsNeededCount} details needed` : ""}
            {" · "}
            {watchingCount} watching
          </Text>
        ) : null}

        <View style={styles.titleRow}>
          <Text style={styles.screenTitle}>Collection</Text>
          <View style={styles.searchBox}>
            <Ionicons color={colors.muted} name="search-outline" size={18} />
            <TextInput
              accessibilityLabel="Search collection"
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
      </View>

      {loadState === "error" ? (
        <View style={styles.bodyPad}>
          <Text style={styles.title}>Could not load inventory.</Text>
          <PrimaryButton
            label="Try again"
            onPress={() => {
              setLoadState("loading");
              void refreshInventory();
            }}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          style={styles.flex}
        >
          {segment === "purchased" && loadState === "ready" ? (
            <ValueHistoryChart
              currentCents={portfolio?.amountCents ?? null}
              currentDisplay={portfolio ? portfolio.display : null}
              disclaimer={portfolio?.disclaimer ?? null}
              points={history.points}
              today={history.today}
            />
          ) : null}
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          {loadState === "loading" && items.length === 0 ? (
            <ActivityIndicator
              accessibilityLabel="Loading collection"
              color={colors.accent}
            />
          ) : visibleItems.length === 0 ? (
            <EmptyState
              hasQuery={Boolean(normalizedQuery)}
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
                    condition: item.condition,
                  },
                  preferences,
                );
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
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.segment}
    >
      <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>
        {label}
      </Text>
      {selected ? <View style={styles.segmentUnderline} /> : <View style={styles.segmentSpacer} />}
    </Pressable>
  );
}

interface EmptyStateProps {
  segment: Segment;
  hasQuery: boolean;
  hasSegmentItems: boolean;
}

function EmptyState({ segment, hasQuery, hasSegmentItems }: EmptyStateProps) {
  if (hasQuery && hasSegmentItems) {
    return <Text style={styles.body}>No matching cards.</Text>;
  }

  if (segment === "watchlist") {
    return (
      <View style={styles.empty}>
        <Text style={styles.title}>Nothing watching.</Text>
        <Text style={styles.body}>Confirm a card, then Watchlist.</Text>
      </View>
    );
  }

  return (
    <View style={styles.empty}>
      <Text style={styles.title}>No purchased copies.</Text>
      <Text style={styles.body}>
        Scan does not create inventory. Confirm, then Purchased.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    gap: space.md,
  },
  bodyPad: { padding: space.lg, gap: space.md },
  content: { padding: space.lg, gap: space.md, paddingBottom: 48 },
  scanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: space.md,
  },
  scannerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.cta,
    alignItems: "center",
    justifyContent: "center",
  },
  scannerCopy: { flex: 1, gap: 2 },
  scannerTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  scannerMeta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  counts: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  screenTitle: { color: colors.text, fontSize: 22, fontWeight: "800" },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: space.sm,
    minHeight: 40,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 8,
  },
  segments: { flexDirection: "row", gap: space.lg },
  segment: { paddingBottom: 2 },
  segmentLabel: { color: colors.muted, fontSize: 16, fontWeight: "700" },
  segmentLabelSelected: { color: colors.text },
  segmentUnderline: {
    height: 2,
    backgroundColor: colors.accent,
    marginTop: 6,
    borderRadius: 1,
  },
  segmentSpacer: { height: 2, marginTop: 6 },
  filterChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
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
    color: colors.accent,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  empty: { gap: space.sm },
  error: { color: colors.danger, fontSize: 14 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
  },
  gridItem: {
    flexGrow: 0,
    flexShrink: 0,
  },
});
