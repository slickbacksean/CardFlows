import Ionicons from "@expo/vector-icons/Ionicons";
import {
  computeMaxBuy,
  CONDITION_LABELS,
  CONFIDENCE_SCREEN_LABEL,
  CONFIRM_TIPS,
  HOW_THIS_WORKS_OPEN_LABEL,
  MAX_BUY_ENTER_REFERENCE_COPY,
  MAX_BUY_YOUR_RULE_LABEL,
  PREGRADE_COPY,
  PRICE_CHECKING_COPY,
  PRICE_ESTIMATE_SCREEN_LABEL,
  PRICE_ESTIMATE_UNAVAILABLE_COPY,
  confidenceWord,
  formatMaxBuyEstimateMeta,
  formatPriceEstimateMeta,
  parseDollarsToCents,
  priceSourceLabel,
  resolvePriceSourceKind,
  type CardFlowCanonicalCard,
  type CardFlowPriceEstimate,
  type MaxBuyPreferences,
} from "@cardflow/shared";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HowThisWorksSheet } from "@/components/ui/how-this-works-sheet";
import { LabeledFigure } from "@/components/ui/labeled-figure";
import { PrimaryButton } from "@/components/ui/primary-button";
import { WatchlistSheet } from "@/components/ui/watchlist-sheet";
import { getCard, getPriceEstimate, savePurchased, saveWatchlist } from "@/lib/api";
import { loadMaxBuyPreferences, peekMaxBuyPreferences } from "@/lib/preferences";
import { colors, space } from "@/lib/theme";
import { defaultVariantId, variantOptions } from "@/lib/variants";

export default function DecideScreen() {
  const router = useRouter();
  const { cardflowCardId, confirmationId, intent, referencePriceAmount, confidence } =
    useLocalSearchParams<{
      cardflowCardId: string;
      confirmationId: string;
      intent?: string | string[];
      referencePriceAmount?: string | string[];
      confidence?: string | string[];
    }>();
  const [card, setCard] = useState<CardFlowCanonicalCard | null>(null);
  const [selectedVariant, setSelectedVariant] = useState("normal");
  const [reference, setReference] = useState(
    () => firstSearchParam(referencePriceAmount) ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [marketEstimate, setMarketEstimate] = useState<CardFlowPriceEstimate | null>(null);
  const [marketState, setMarketState] = useState<"loading" | "ready">("loading");
  const [priceProvider, setPriceProvider] = useState<string | null>(null);
  const [priceFetchedAt, setPriceFetchedAt] = useState<string | null>(null);
  const [howThisWorksOpen, setHowThisWorksOpen] = useState(false);
  const [referenceFetchedAt, setReferenceFetchedAt] = useState<string | null>(
    () => (firstSearchParam(referencePriceAmount) ? new Date().toISOString() : null),
  );
  const [preferences, setPreferences] = useState<MaxBuyPreferences>(
    peekMaxBuyPreferences,
  );
  const [condition, setCondition] = useState<(typeof CONDITION_LABELS)[number]>("NM");
  const confirmationIdValue = Array.isArray(confirmationId)
    ? confirmationId[0]
    : confirmationId;
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
  const marketKey = `${canCommitInventory ? (card?.tcgdexId ?? "") : ""}:${selectedVariant}`;
  const [marketKeySeen, setMarketKeySeen] = useState(marketKey);
  if (marketKeySeen !== marketKey) {
    setMarketKeySeen(marketKey);
    setMarketEstimate(null);
    setMarketState("loading");
    setPriceProvider(null);
    setPriceFetchedAt(null);
  }

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
          defaultVariantId(result.canonicalCard.variants, result.canonicalCard.selectedVariant),
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
  }, [cardflowCardId]);

  useEffect(() => {
    if (!card?.tcgdexId || !canCommitInventory) return;
    let cancelled = false;
    void getPriceEstimate(card.tcgdexId, selectedVariant)
      .then((result) => {
        if (cancelled) return;
        setMarketEstimate(result.estimate);
        setPriceProvider(result.provider);
        setPriceFetchedAt(result.estimate.fetchedAt ?? new Date().toISOString());
        setMarketState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setMarketEstimate(null);
        setPriceProvider(null);
        setPriceFetchedAt(null);
        setMarketState("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [canCommitInventory, card?.tcgdexId, selectedVariant]);

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
  const estimateReference = marketEstimate?.amount ?? null;
  const maxBuyReference = typedReference ?? estimateReference;
  const maxBuy = useMemo(
    () =>
      computeMaxBuy({
        referencePriceAmount: maxBuyReference,
        condition,
        preferences,
      }),
    [condition, maxBuyReference, preferences],
  );
  const hasReference = maxBuy.referencePriceCents !== null;
  const matchConfidence = confidenceWord(firstSearchParam(confidence));
  const vendorSourceKind = resolvePriceSourceKind({
    provider: priceProvider,
    source: marketEstimate?.source,
    referenceSource: marketEstimate?.referenceSource,
  });
  const maxBuySourceKind = typedReference ? "your_price" : vendorSourceKind;
  const vendorPriceMeta = formatPriceEstimateMeta({
    sourceLabel: priceSourceLabel(vendorSourceKind),
    fetchedAt: priceFetchedAt,
  });
  const maxBuyMeta = formatMaxBuyEstimateMeta({
    sourceLabel: priceSourceLabel(maxBuySourceKind),
    fetchedAt: typedReference ? referenceFetchedAt : priceFetchedAt,
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

  async function onAddCard() {
    if (!confirmationIdValue) return;
    const marketPrice = marketEstimate?.amount;
    if (!marketPrice) {
      setError(PRICE_ESTIMATE_UNAVAILABLE_COPY);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await savePurchased({
        confirmationId: confirmationIdValue,
        purchasePrice: marketPrice,
        purchasedAt: new Date().toISOString(),
        condition,
        selectedVariant,
      });
      router.replace({
        pathname: "/(tabs)/collection",
        params: { segment: "purchased" },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  async function onSaveWatchlist(variantId: string) {
    if (!confirmationIdValue) return;
    setIsSaving(true);
    setError(null);
    try {
      await saveWatchlist({
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
                  {marketState === "loading" ? (
                    <Text style={styles.body}>{PRICE_CHECKING_COPY}</Text>
                  ) : marketEstimate?.amount ? (
                    <>
                      <Text style={styles.marketPrice}>${marketEstimate.amount}</Text>
                      <Text style={styles.body}>{vendorPriceMeta}</Text>
                      <Text style={styles.body}>{marketEstimate.disclaimer}</Text>
                    </>
                  ) : (
                    <Text style={styles.body}>{PRICE_ESTIMATE_UNAVAILABLE_COPY}</Text>
                  )}
                </LabeledFigure>
                <LabeledFigure label={MAX_BUY_YOUR_RULE_LABEL} tip={CONFIRM_TIPS.maxBuy}>
                  {hasReference && maxBuy.maxBuyAmount ? (
                    <>
                      <Text style={styles.marketPrice}>${maxBuy.maxBuyAmount}</Text>
                      <Text style={styles.body}>{maxBuyMeta}</Text>
                      <Text style={styles.body}>{maxBuy.disclaimer}</Text>
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
                  disabled={isSaving || marketState === "loading" || !marketEstimate?.amount}
                  label={isSaving ? "Adding…" : "Add card"}
                  onPress={() => void onAddCard()}
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
                <Text style={styles.body}>Save as Purchased first to draft.</Text>
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
