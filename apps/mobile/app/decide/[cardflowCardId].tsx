import Ionicons from "@expo/vector-icons/Ionicons";
import { TcgplayerAttribution } from "@/components/ui/tcgplayer-attribution";
import { trackEvent } from "@/lib/product-events";
import { runQueueableWrite } from "@/lib/write-queue";
import {
  MAKE_LISTING_LABEL,
  computeMaxBuy,
  CONDITION_LABELS,
  CONFIDENCE_SCREEN_LABEL,
  CONFIRM_TIPS,
  HOW_THIS_WORKS_OPEN_LABEL,
  MAX_BUY_ENTER_REFERENCE_COPY,
  MAX_BUY_YOUR_RULE_LABEL,
  PREGRADE_COPY,
  PRICE_CHECKING_COPY,
  PRICE_REFRESHING_COPY,
  PRICE_UNAVAILABLE_ENTER_OWN_COPY,
  WATCHLIST_SAVED_MAX_BUY_META,
  YOUR_PRICE_INPUT_LABEL,
  SAVE_YOUR_PRICE_LABEL,
  priceSnapshotOptions,
  selectMaxBuyReference,
  userPriceLabel,
  priceDisplayState,
  PRICE_ESTIMATE_SCREEN_LABEL,
  PRICE_ESTIMATE_UNAVAILABLE_COPY,
  confidenceWord,
  formatMaxBuyEstimateMeta,
  formatPriceEstimateMeta,
  parseDollarsToCents,
  priceSourceLabel,
  purchasedFailureMessage,
  resolvePriceSourceKind,
  type CardFlowCanonicalCard,
  type CardFlowPriceEstimate,
  type MaxBuyPreferences,
} from "@cardflow/shared";
import { Image } from "expo-image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HowThisWorksSheet } from "@/components/ui/how-this-works-sheet";
import { playPurchasedSuccessHaptic } from "@/components/ui/hud-bubble";
import { LabeledFigure } from "@/components/ui/labeled-figure";
import { MaxBuyBreakdownToggle } from "@/components/ui/max-buy-breakdown";
import { PrimaryButton } from "@/components/ui/primary-button";
import { WatchlistSheet } from "@/components/ui/watchlist-sheet";
import {
  getCard,
  listUserPriceSnapshots,
  openOrCreateDraft,
  saveUserPriceSnapshot,
} from "@/lib/api";
import { priceQueryOptions } from "@/lib/price-queries";
import { loadMaxBuyPreferences, peekMaxBuyPreferences } from "@/lib/preferences";
import { colors, space } from "@/lib/theme";
import { defaultVariantId, variantOptions } from "@/lib/variants";

export default function DecideScreen() {
  const router = useRouter();
  const {
    cardflowCardId,
    confirmationId,
    intent,
    inventoryItemId,
    referencePriceAmount,
    confidence,
    selectedVariant: routeVariant,
    targetMaxBuyAmount,
    condition: routeCondition,
  } = useLocalSearchParams<{
    cardflowCardId: string;
    confirmationId: string;
    intent?: string | string[];
    inventoryItemId?: string | string[];
    referencePriceAmount?: string | string[];
    confidence?: string | string[];
    selectedVariant?: string | string[];
    targetMaxBuyAmount?: string | string[];
    condition?: string | string[];
  }>();
  const [card, setCard] = useState<CardFlowCanonicalCard | null>(null);
  const [selectedVariant, setSelectedVariant] = useState("normal");
  const [reference, setReference] = useState(
    () => firstSearchParam(referencePriceAmount) ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const purchaseInFlightRef = useRef(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [howThisWorksOpen, setHowThisWorksOpen] = useState(false);
  const [referenceFetchedAt, setReferenceFetchedAt] = useState<string | null>(
    () => (firstSearchParam(referencePriceAmount) ? new Date().toISOString() : null),
  );
  const [preferences, setPreferences] = useState<MaxBuyPreferences>(
    peekMaxBuyPreferences,
  );
  const [condition, setCondition] = useState<(typeof CONDITION_LABELS)[number]>(
    () => conditionFromParam(routeCondition),
  );
  const confirmationIdValue = Array.isArray(confirmationId)
    ? confirmationId[0]
    : confirmationId;
  const watchlistItemId = firstSearchParam(inventoryItemId);
  const savedIntentRaw = Array.isArray(intent) ? intent[0] : intent;
  const savedIntent =
    savedIntentRaw === "watchlist" || savedIntentRaw === "purchased"
      ? savedIntentRaw
      : null;
  const canCommitInventory = Boolean(confirmationIdValue);
  const routeReference = firstSearchParam(referencePriceAmount) ?? "";
  const referenceSeed = `${cardflowCardId ?? ""}:${routeReference}`;
  const [referenceSeedSeen, setReferenceSeedSeen] = useState(referenceSeed);
  if (referenceSeedSeen !== referenceSeed) {
    setReferenceSeedSeen(referenceSeed);
    setReference(routeReference);
    setReferenceFetchedAt(routeReference ? new Date().toISOString() : null);
  }
  const priceQuery = useQuery({
    ...priceQueryOptions(card?.tcgdexId ?? "", selectedVariant),
    enabled: Boolean(card?.tcgdexId) && canCommitInventory,
  });
  const marketEstimate: CardFlowPriceEstimate | null = priceQuery.data?.estimate ?? null;
  const queryClient = useQueryClient();
  const yourPricesKey = ["cardflow", "userPriceSnapshots", { tcgdexId: card?.tcgdexId ?? "", variant: selectedVariant }] as const;
  const yourPricesQuery = useQuery({
    queryKey: yourPricesKey,
    queryFn: () => listUserPriceSnapshots(card?.tcgdexId ?? "", selectedVariant),
    enabled: Boolean(card?.tcgdexId) && canCommitInventory,
  });
  const [pickedPriceKey, setPickedPriceKey] = useState<string | null>(null);
  const [isSavingPrice, setIsSavingPrice] = useState(false);
  const priceProvider = priceQuery.data?.provider ?? null;
  const priceFetchedAt = priceQuery.data
    ? (marketEstimate?.fetchedAt ?? new Date(priceQuery.dataUpdatedAt).toISOString())
    : null;
  const priceDisplay = priceDisplayState({
    estimate: marketEstimate,
    isPending: priceQuery.isPending,
    isFetching: priceQuery.isFetching,
    isError: priceQuery.isError,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!cardflowCardId) {
        setError("Card not found");
        return;
      }
      try {
        const result = await getCard(cardflowCardId);
        if (cancelled) return;
        setCard(result.canonicalCard);
        setSelectedVariant(
          defaultVariantId(
            result.canonicalCard.variants,
            firstSearchParam(routeVariant) ?? result.canonicalCard.selectedVariant,
          ),
        );
        setError(null);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Card not found");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [cardflowCardId, routeVariant]);

  useFocusEffect(
    useCallback(() => {
      setPreferences(peekMaxBuyPreferences());
      let cancelled = false;
      void loadMaxBuyPreferences()
        .then((next) => {
          if (!cancelled) setPreferences(next);
        })
        .catch(() => {
          if (!cancelled) setPreferences(peekMaxBuyPreferences());
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const typedReference = parsedReference(reference);
  const vendorSourceLabel = priceSourceLabel(
    resolvePriceSourceKind({
      provider: priceProvider,
      source: marketEstimate?.source,
      referenceSource: marketEstimate?.referenceSource,
    }),
  );
  // P1-12: your saved prices sit next to the vendor price; Max Buy uses the one you pick (newest by default).
  const priceOptions = priceSnapshotOptions({
    userSnapshots: yourPricesQuery.data?.snapshots ?? [],
    vendor: { amount: marketEstimate?.amount, at: priceFetchedAt, sourceLabel: vendorSourceLabel },
  });
  const pickedReference = selectMaxBuyReference(priceOptions, pickedPriceKey);
  const maxBuyReference = typedReference ?? pickedReference?.amount ?? null;
  const maxBuy = computeMaxBuy({
    referencePriceAmount: maxBuyReference,
    condition,
    preferences,
  });
  const hasReference = maxBuy.referencePriceCents !== null;
  const matchConfidence = confidenceWord(firstSearchParam(confidence));
  const vendorSourceKind = resolvePriceSourceKind({
    provider: priceProvider,
    source: marketEstimate?.source,
    referenceSource: marketEstimate?.referenceSource,
  });
  const maxBuySourceKind =
    typedReference || pickedReference?.kind === "you" ? "your_price" : vendorSourceKind;
  const vendorPriceMeta = formatPriceEstimateMeta({
    sourceLabel: priceSourceLabel(vendorSourceKind),
    fetchedAt: priceFetchedAt,
  });
  const maxBuyMeta = formatMaxBuyEstimateMeta({
    sourceLabel: priceSourceLabel(maxBuySourceKind),
    fetchedAt: typedReference ? referenceFetchedAt : (pickedReference?.at ?? priceFetchedAt),
  });

  const variants = card ? variantOptions(card.variants) : [];
  const title = card ? `${card.name} #${card.localId}` : "";

  function goBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/collection");
  }

  function onSelectVariant(variantId: string) {
    setSelectedVariant(variantId);
    setCard((current) =>
      current ? { ...current, selectedVariant: variantId } : current,
    );
  }

  async function onAddCard(then: "collection" | "listing" = "collection") {
    if (!confirmationIdValue) return;
    // Community review 4: duplicate guard (a double tap saves once).
    if (purchaseInFlightRef.current) return;
    // Prices never block: your own typed price stands in when the estimate is unavailable.
    const marketPrice = marketEstimate?.amount ?? typedReference ?? pickedReference?.amount ?? null;
    if (!marketPrice) {
      setError(PRICE_ESTIMATE_UNAVAILABLE_COPY);
      return;
    }
    purchaseInFlightRef.current = true;
    setIsSaving(true);
    setError(null);
    try {
      trackEvent("purchased", { source: "candidate" });
      const outcome = await runQueueableWrite("save_purchased", {
        confirmationId: confirmationIdValue,
        purchasePrice: marketPrice,
        purchasedAt: new Date().toISOString(),
        condition,
        selectedVariant,
      });
      if (then === "listing" && !outcome.queued) {
        // P2-02: straight into a draft built from the confirmed card. Offline: saved to Collection only.
        const draft = await openOrCreateDraft(outcome.result.item.inventoryItemId);
        router.replace(`/draft/${draft.draft.draftId}`);
        return;
      }
      router.replace({
        pathname: "/(tabs)/collection",
        params: { segment: "purchased" },
      });
    } catch (caught) {
      setError(purchasedFailureMessage(caught));
    } finally {
      purchaseInFlightRef.current = false;
      setIsSaving(false);
    }
  }

  async function onSaveYourPrice() {
    if (!card?.tcgdexId || !typedReference) return;
    setIsSavingPrice(true);
    setError(null);
    try {
      const saved = await saveUserPriceSnapshot(card.tcgdexId, typedReference, selectedVariant);
      await queryClient.invalidateQueries({ queryKey: yourPricesKey });
      setPickedPriceKey(`you:${saved.snapshot.snapshotId}`);
      setReference("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed");
    } finally {
      setIsSavingPrice(false);
    }
  }

  async function onWatchlistPurchased() {
    if (!watchlistItemId || purchaseInFlightRef.current) return;
    purchaseInFlightRef.current = true;
    setIsSaving(true);
    setError(null);
    try {
      const saved = await runQueueableWrite("watchlist_to_purchased", {
        inventoryItemId: watchlistItemId,
      });
      await playPurchasedSuccessHaptic();
      router.replace({
        pathname: "/(tabs)/collection",
        params: {
          segment: "purchased",
          purchasedUndoId: saved.queued ? saved.queuedId : saved.result.item.inventoryItemId,
        },
      });
    } catch (caught) {
      setError(purchasedFailureMessage(caught));
    } finally {
      purchaseInFlightRef.current = false;
      setIsSaving(false);
    }
  }

  async function onSaveWatchlist(variantId: string) {
    if (!confirmationIdValue) return;
    setIsSaving(true);
    setError(null);
    try {
      await runQueueableWrite("save_watchlist", {
        confirmationId: confirmationIdValue,
        selectedVariant: variantId,
        referencePriceAmount: parsedReference(reference),
        targetMaxBuyAmount: maxBuy.maxBuyAmount,
        condition,
      });
      setWatchlistOpen(false);
      router.replace({
        pathname: "/(tabs)/collection",
        params: { segment: "watchlist" },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          hitSlop={12}
          onPress={goBack}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="chevron-back" size={28} />
        </Pressable>
        <Text numberOfLines={1} style={styles.topTitle}>
          {title}
        </Text>
        <Pressable
          accessibilityLabel={HOW_THIS_WORKS_OPEN_LABEL}
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => setHowThisWorksOpen(true)}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="help-circle-outline" size={26} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {!card && !error ? <Text style={styles.body}>Loading card…</Text> : null}
        {!card && error ? <Text style={styles.error}>{error}</Text> : null}

        {card ? (
          <View style={styles.stack}>
            <View style={styles.heroWrap}>
              {card.image.constructedUrl ? (
                <Image
                  accessibilityIgnoresInvertColors
                  accessibilityLabel={`${card.name} catalog art`}
                  contentFit="contain"
                  source={{ uri: card.image.constructedUrl }}
                  style={styles.hero}
                />
              ) : (
                <View
                  accessibilityLabel={`${card.name} catalog art`}
                  style={[styles.hero, styles.heroFallback]}
                />
              )}
            </View>

            <Text style={styles.cardName}>{title}</Text>
            <View style={styles.pills}>
              <Pill label={card.category} />
              <Pill label={card.set.name} />
              <Pill label={`#${card.localId}`} />
              <Pill label={(card.language ?? "en").toUpperCase()} />
            </View>
            {variants.length > 0 ? (
              <View style={styles.pills}>
                {variants.map((variant) => (
                  <Pill
                    key={variant.id}
                    label={variant.label}
                    onPress={() => onSelectVariant(variant.id)}
                    selected={selectedVariant === variant.id}
                  />
                ))}
              </View>
            ) : null}
            <Text style={styles.caption}>Catalog art — not your listing pic</Text>

            {canCommitInventory ? (
              <>
                <LabeledFigure label={PRICE_ESTIMATE_SCREEN_LABEL} tip={CONFIRM_TIPS.priceSource}>
                  {priceDisplay.kind === "checking" ? (
                    <Text style={styles.body}>{PRICE_CHECKING_COPY}</Text>
                  ) : priceDisplay.kind === "price" && marketEstimate?.amount ? (
                    <>
                      <Text style={styles.marketPrice}>${marketEstimate.amount}</Text>
                      <Text style={styles.body}>{vendorPriceMeta}</Text>
                      {priceDisplay.refreshing ? (
                        <Text accessibilityLiveRegion="polite" style={styles.caption}>
                          {PRICE_REFRESHING_COPY}
                        </Text>
                      ) : null}
                      <Text style={styles.body}>{marketEstimate.disclaimer}</Text>
                      <TcgplayerAttribution />
                    </>
                  ) : (
                    <Text style={styles.body}>{PRICE_UNAVAILABLE_ENTER_OWN_COPY}</Text>
                  )}
                  {priceOptions.length > 0 ? (
                    <View style={styles.pills}>
                      {priceOptions.map((option) => {
                        const selected = !typedReference && pickedReference?.key === option.key;
                        const label =
                          option.kind === "you"
                            ? `${userPriceLabel(option.at)} · $${option.amount}`
                            : `${option.sourceLabel} · $${option.amount}`;
                        return (
                          <Pressable
                            accessibilityLabel={`Use ${label} for Max Buy`}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            key={option.key}
                            onPress={() => {
                              setPickedPriceKey(option.key);
                              setReference("");
                            }}
                            style={[styles.pill, styles.pillTap, selected && styles.pillSelected]}
                          >
                            <Text style={[styles.pillLabel, selected && styles.pillLabelSelected]}>
                              {selected ? "✓ " : ""}{label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                  <>
                      <TextInput
                        accessibilityLabel={YOUR_PRICE_INPUT_LABEL}
                        inputMode="decimal"
                        keyboardType="decimal-pad"
                        onChangeText={(value) => {
                          setReference(value);
                          setReferenceFetchedAt(new Date().toISOString());
                        }}
                        placeholder={YOUR_PRICE_INPUT_LABEL}
                        placeholderTextColor={colors.muted}
                        style={styles.priceInput}
                        value={reference}
                      />
                      {typedReference ? (
                        <PrimaryButton
                          disabled={isSavingPrice}
                          label={SAVE_YOUR_PRICE_LABEL}
                          onPress={() => void onSaveYourPrice()}
                        />
                      ) : null}
                  </>
                </LabeledFigure>
                <LabeledFigure label={MAX_BUY_YOUR_RULE_LABEL} tip={CONFIRM_TIPS.maxBuy}>
                  {hasReference && maxBuy.maxBuyAmount ? (
                    <>
                      <Text style={styles.marketPrice}>${maxBuy.maxBuyAmount}</Text>
                      <Text style={styles.body}>{maxBuyMeta}</Text>
                      <Text style={styles.body}>{maxBuy.disclaimer}</Text>
                      <MaxBuyBreakdownToggle
                        computation={maxBuy}
                        onEditRule={() => router.push("/max-buy-rules")}
                      />
                    </>
                  ) : (
                    <Text style={styles.body}>{MAX_BUY_ENTER_REFERENCE_COPY}</Text>
                  )}
                </LabeledFigure>
                <LabeledFigure label={CONFIDENCE_SCREEN_LABEL} tip={CONFIRM_TIPS.confidence}>
                  <Text style={styles.body}>{matchConfidence ?? "—"}</Text>
                </LabeledFigure>
                <LabeledFigure label={PREGRADE_COPY.title} tip={CONFIRM_TIPS.estimate}>
                  <Text style={styles.body}>{PREGRADE_COPY.disclaimer}</Text>
                </LabeledFigure>
              </>
            ) : null}

            {error && !watchlistOpen ? <Text style={styles.error}>{error}</Text> : null}

            {canCommitInventory ? (
              <>
                <Text style={styles.label}>Condition</Text>
                <View accessibilityRole="radiogroup" style={styles.pills}>
                  {CONDITION_LABELS.map((label) => (
                    <Pill
                      key={label}
                      label={label}
                      onPress={() => setCondition(label)}
                      selected={condition === label}
                    />
                  ))}
                </View>
                <PrimaryButton
                  disabled={isSaving || (!marketEstimate?.amount && !typedReference)}
                  label={isSaving ? "Adding…" : "Add card"}
                  onPress={() => void onAddCard()}
                />
                <PrimaryButton
                  disabled={isSaving || (!marketEstimate?.amount && !typedReference)}
                  label={MAKE_LISTING_LABEL}
                  onPress={() => void onAddCard("listing")}
                  tone="muted"
                />
                <PrimaryButton
                  disabled={isSaving}
                  label="Watchlist"
                  onPress={() => {
                    setError(null);
                    setWatchlistOpen(true);
                  }}
                  tone="muted"
                />
              </>
            ) : savedIntent === "watchlist" ? (
              <View style={styles.missing}>
                <Text style={styles.body}>Watching. Cannot create a listing draft.</Text>
                <LabeledFigure label={MAX_BUY_YOUR_RULE_LABEL} tip={CONFIRM_TIPS.maxBuy}>
                  {maxBuy.maxBuyAmount ? (
                    <>
                      <Text style={styles.marketPrice}>${maxBuy.maxBuyAmount}</Text>
                      <Text style={styles.body}>{maxBuyMeta}</Text>
                    </>
                  ) : firstSearchParam(targetMaxBuyAmount) ? (
                    <>
                      <Text style={styles.marketPrice}>${firstSearchParam(targetMaxBuyAmount)}</Text>
                      <Text style={styles.body}>{WATCHLIST_SAVED_MAX_BUY_META}</Text>
                    </>
                  ) : (
                    <Text style={styles.body}>No Max Buy snapshot on this Watchlist item.</Text>
                  )}
                </LabeledFigure>
                <Text style={styles.body}>
                  Purchased keeps this card and Max Buy. Price is optional until Collection →
                  Purchased.
                </Text>
                <PrimaryButton
                  disabled={isSaving || !watchlistItemId}
                  label={isSaving ? "Saving…" : "Purchased"}
                  onPress={() => void onWatchlistPurchased()}
                />
              </View>
            ) : null}
            <GhostButton
              label={HOW_THIS_WORKS_OPEN_LABEL}
              onPress={() => setHowThisWorksOpen(true)}
            />
            <GhostButton
              label="Edit Max Buy rules"
              onPress={() => router.push("/max-buy-rules")}
            />
          </View>
        ) : null}
      </ScrollView>

      {card && canCommitInventory ? (
        <WatchlistSheet
          error={watchlistOpen ? error : null}
          isSaving={isSaving}
          disclaimer={maxBuy.disclaimer}
          estimateMeta={hasReference ? maxBuyMeta : null}
          hasReference={hasReference}
          localId={card.localId}
          maxBuyAmount={maxBuy.maxBuyAmount}
          name={card.name}
          onChangeReference={(value) => {
            setReference(value);
            setReferenceFetchedAt(new Date().toISOString());
          }}
          onClose={() => {
            if (!isSaving) setWatchlistOpen(false);
          }}
          reference={reference}
          rulesLine={`${condition} · ${Math.round(maxBuy.currentTargetMarginPct * 100)}% margin · ${Math.round(maxBuy.currentFeesBufferPct * 100)}% fees`}
          onChangeCondition={setCondition}
          condition={condition}
          onSave={(variantId) => void onSaveWatchlist(variantId)}
          selectedVariant={selectedVariant}
          setName={card.set.name}
          variants={card.variants}
          visible={watchlistOpen}
        />
      ) : null}
      <HowThisWorksSheet onClose={() => setHowThisWorksOpen(false)} visible={howThisWorksOpen} />
    </SafeAreaView>
  );
}

function parsedReference(value: string): string | null {
  const cents = parseDollarsToCents(value);
  if (cents === null) return null;
  return (cents / 100).toFixed(2);
}

function conditionFromParam(
  value: string | string[] | undefined,
): (typeof CONDITION_LABELS)[number] {
  const raw = firstSearchParam(value);
  const match = CONDITION_LABELS.find((label) => label === raw);
  return match ?? CONDITION_LABELS[0];
}

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface PillProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}

function Pill({ label, selected = false, onPress }: PillProps) {
  const content = (
    <Text style={[styles.pillLabel, selected && styles.pillLabelSelected]}>{label}</Text>
  );

  if (!onPress) {
    return <View style={styles.pill}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.pill, selected && styles.pillSelected]}
    >
      {content}
    </Pressable>
  );
}

interface GhostButtonProps {
  label: string;
  onPress: () => void;
}

function GhostButton({ label, onPress }: GhostButtonProps) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.ghost}>
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
  content: { paddingHorizontal: space.lg, paddingBottom: 48, gap: space.md },
  stack: { gap: space.md },
  heroWrap: { alignItems: "center" },
  hero: {
    width: 188,
    aspectRatio: 0.715,
    borderRadius: 16,
    backgroundColor: colors.chip,
  },
  heroFallback: { borderWidth: 1, borderColor: colors.cardBorder },
  cardName: { color: colors.text, fontSize: 28, fontWeight: "800", textAlign: "center" },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.xs,
    justifyContent: "center",
  },
  pill: {
    backgroundColor: colors.chip,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillTap: { minHeight: 44, justifyContent: "center" },
  pillSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pillLabel: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  pillLabelSelected: { color: colors.accent },
  caption: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  missing: { gap: 8 },
  label: { color: colors.text, fontWeight: "700" },
  marketPrice: { color: colors.text, fontSize: 28, fontWeight: "800" },
  priceInput: {
    backgroundColor: colors.bg,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 18,
  },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  error: { color: colors.danger, fontSize: 14 },
  ghost: {
    borderRadius: 12,
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  ghostLabel: { color: colors.text, fontSize: 16, fontWeight: "700" },
});
