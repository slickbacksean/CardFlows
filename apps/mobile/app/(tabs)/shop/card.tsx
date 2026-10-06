import {
  PRICE_ESTIMATE_DISCLAIMER,
  SLAB_COMPANIES,
  SLAB_PRICE_DISCLAIMER,
  hasTcgplayerMarket,
  type CardFlowPriceEstimate,
  type CardFlowSlabEstimate,
  type SlabCompany,
} from "@cardflow/shared";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { shopColors, shopSpace } from "@/components/shop/shop-theme";
import { getPriceEstimate, getSlabEstimates } from "@/lib/api";
import {
  ebayUrl,
  formatReleaseDate,
  loadCardDetail,
  pricedVariant,
  shopMarketAmount,
  tcgplayerUrl,
  variantChoices,
  type ShopCardDetail,
  type ShopVariantChoice,
} from "@/lib/shop-catalog";
import { firstRouteParam, formatDexNumber } from "@/lib/shop-dex";

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  Water: "water",
  Lightning: "flash",
  Fire: "flame",
  Grass: "leaf",
  Psychic: "eye",
  Darkness: "moon",
  Colorless: "star",
  Fairy: "heart",
};

const TYPE_COLOR: Record<string, string> = {
  Colorless: "#A8A878",
  Darkness: "#705848",
  Dragon: "#7038F8",
  Fairy: "#EE99AC",
  Fighting: "#C03028",
  Fire: "#F08030",
  Grass: "#78C850",
  Lightning: "#F8D030",
  Metal: "#B8B8D0",
  Psychic: "#F85888",
  Water: "#6890F0",
};

const EMPTY_MARKET = {
  normal: null,
  holo: null,
  reverse: null,
  firstEdition: null,
};

const COMPANY_GRADES: Record<SlabCompany, readonly string[]> = {
  PSA: ["10", "9", "8"],
  BGS: ["10", "9.5", "9"],
  CGC: ["10", "9.5", "9"],
  TAG: ["10", "9", "8"],
};

function gradesForCompany(company: SlabCompany, slabs: CardFlowSlabEstimate | null) {
  const amounts = new Map<string, string | null>();
  for (const grade of COMPANY_GRADES[company]) amounts.set(grade, null);
  for (const tier of slabs?.gradedTiers ?? []) {
    if (tier.company === company && !amounts.has(tier.grade)) amounts.set(tier.grade, null);
  }
  for (const row of slabs?.rows ?? []) {
    if (row.company === company) amounts.set(row.grade, row.amount);
  }
  return [...amounts.entries()]
    .map(([grade, amount]) => ({ grade, amount }))
    .sort((left, right) => Number(right.grade) - Number(left.grade));
}

export default function ShopCardScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ cardId?: string }>();
  const cardId = firstRouteParam(params.cardId);
  const [card, setCard] = useState<ShopCardDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    cardId ? "loading" : "error",
  );
  const [seenCardId, setSeenCardId] = useState(cardId);
  const [variant, setVariant] = useState<ShopVariantChoice | null>(null);
  const [price, setPrice] = useState<CardFlowPriceEstimate | null>(null);
  const [priceFor, setPriceFor] = useState<string | null>(null);
  if (cardId !== seenCardId) {
    setSeenCardId(cardId);
    setStatus(cardId ? "loading" : "error");
    setCard(null);
    setVariant(null);
    setPrice(null);
    setPriceFor(null);
  }
  const [slabs, setSlabs] = useState<CardFlowSlabEstimate | null>(null);
  const [company, setCompany] = useState<SlabCompany>("PSA");
  const [openAttack, setOpenAttack] = useState<number | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (!cardId) return;
    let cancelled = false;
    void loadCardDetail(cardId)
      .then((detail) => {
        if (cancelled) return;
        setCard(detail);
        setVariant(pricedVariant(detail.variants, detail.marketPrices));
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    void getSlabEstimates(cardId).then((estimate) => {
      if (!cancelled) setSlabs(estimate);
    });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  const catalogMarket = hasTcgplayerMarket(card?.marketPrices ?? EMPTY_MARKET);
  const catalogAmount = shopMarketAmount(card?.marketPrices ?? EMPTY_MARKET, variant?.query);

  useEffect(() => {
    if (!card || !variant || catalogMarket) return;
    let cancelled = false;
    const query = variant.query;
    const id = card.id;
    void getPriceEstimate(id, query)
      .then((response) => {
        if (cancelled) return;
        setPrice(response.estimate);
        setPriceFor(`${id}:${query}`);
      })
      .catch(() => {
        if (cancelled) return;
        setPrice(null);
        setPriceFor(`${id}:${query}`);
      });
    return () => {
      cancelled = true;
    };
  }, [card, catalogMarket, variant]);

  const companyGrades = useMemo(() => gradesForCompany(company, slabs), [company, slabs]);
  const choices = card ? variantChoices(card.variants) : [];
  const shownPrice = catalogMarket ? catalogAmount : price?.amount ?? null;
  const priceLoading =
    !catalogMarket && priceFor !== `${card?.id ?? ""}:${variant?.query ?? ""}`;

  async function openUrl(url: string) {
    setLinkError(null);
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError("Could not open that marketplace.");
    }
  }

  if (status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={shopColors.text} />
      </View>
    );
  }

  if (status === "error" || !card || !variant) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Could not load this card.</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.retry}>
          <Text style={styles.retryLabel}>Close</Text>
        </Pressable>
      </View>
    );
  }

  const releaseDate = formatReleaseDate(card.set.releaseDate);
  const edges = Platform.OS === "ios" ? (["bottom"] as const) : (["top", "bottom"] as const);

  return (
    <SafeAreaView edges={edges} style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Share card"
          accessibilityRole="button"
          onPress={() => {
            void Share.share({
              message: `${card.name} #${card.localId} · ${card.set.name}`,
            });
          }}
          style={styles.circle}
        >
          <Ionicons color={shopColors.text} name="share-outline" size={18} />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>
          {card.name}
        </Text>
        <Pressable
          accessibilityLabel="Close"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.circle}
        >
          <Ionicons color={shopColors.text} name="close" size={22} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.priceRow}>
          {card.imageUrl ? (
            <Image
              accessibilityIgnoresInvertColors
              cachePolicy="memory-disk"
              contentFit="contain"
              source={{ uri: card.imageUrl }}
              style={styles.hero}
            />
          ) : (
            <View style={styles.hero} />
          )}
          <View style={styles.priceBox}>
            {choices.length > 1 ? (
              <View style={styles.variantRow}>
                {choices.map((choice) => {
                  const selected = choice.query === variant.query;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      key={choice.query}
                      onPress={() => setVariant(choice)}
                    >
                      <Text style={[styles.variant, selected && styles.variantSelected]}>
                        {choice.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.variant}>{variant.label}</Text>
            )}
            {priceLoading ? (
              <ActivityIndicator color={shopColors.text} />
            ) : (
              <Text style={styles.price}>{shownPrice ? `$${shownPrice}` : "—"}</Text>
            )}
            <Text style={styles.estimateLabel}>{catalogMarket ? "Market" : "Estimate"}</Text>
          </View>
        </View>

        <View style={styles.identity}>
          <Text style={styles.localId}>#{card.localId}</Text>
          {card.rarity ? (
            <View style={styles.rarityPill}>
              <Text style={styles.rarityText}>{card.rarity}</Text>
            </View>
          ) : null}
          <View style={styles.identitySpacer} />
          {card.illustrator ? (
            <View style={styles.illustrator}>
              <Ionicons color={shopColors.text} name="brush-outline" size={14} />
              <Text numberOfLines={1} style={styles.illustratorText}>
                {card.illustrator}
              </Text>
            </View>
          ) : null}
        </View>
        {card.dexId ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              router.navigate({
                pathname: "/shop/pokemon/[dexId]",
                params: { dexId: String(card.dexId) },
              });
            }}
          >
            <Text style={styles.dexLine}>
              {formatDexNumber(card.dexId, 3)}{" "}
              <Text style={styles.dexName}>{card.name}</Text>
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Price history</Text>
          <View style={styles.chart}>
            <View style={styles.chartLine} />
            <View style={styles.chartDot} />
          </View>
          <View style={styles.chartLabels}>
            <Text style={styles.muted}>Earlier prices</Text>
            <Text style={styles.today}>Today {shownPrice ? `$${shownPrice}` : "—"}</Text>
          </View>
          <Text style={styles.disclaimer}>
            {catalogMarket
              ? shownPrice
                ? "TCGPlayer market price for this printing."
                : "No TCGPlayer market price for this printing."
              : shownPrice
                ? `Today's estimate is the latest price on file. ${PRICE_ESTIMATE_DISCLAIMER}`
                : PRICE_ESTIMATE_DISCLAIMER}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Graded cards</Text>
          <View style={styles.companyRow}>
            {SLAB_COMPANIES.map((name) => {
              const open = company === name;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  key={name}
                  onPress={() => setCompany(name)}
                  style={[styles.companyBlock, open && styles.companyBlockOpen]}
                >
                  <Text style={styles.companyText}>{name}</Text>
                  <Ionicons
                    color={shopColors.text}
                    name={open ? "chevron-up" : "chevron-down"}
                    size={14}
                  />
                </Pressable>
              );
            })}
          </View>
          {companyGrades.map((row) => (
            <View key={`${company}-${row.grade}`} style={styles.gradeRow}>
              <View style={styles.gradeBadge}>
                <Text style={styles.gradeCompany}>{company}</Text>
                <Text style={styles.gradeNumber}>{row.grade}</Text>
              </View>
              <Text style={[styles.muted, styles.gradeLabel]}>Average</Text>
              <Text style={[styles.gradePrice, !row.amount && styles.gradeMissing]}>
                {row.amount ? `$${row.amount}` : "N/A"}
              </Text>
            </View>
          ))}
          <Text style={styles.disclaimer}>{SLAB_PRICE_DISCLAIMER}</Text>
        </View>

        {card.weaknesses.length > 0 || card.retreat !== null ? (
          <View style={styles.section}>
            {card.weaknesses.map((weakness) => (
              <View key={`${weakness.type}-${weakness.value}`} style={styles.statRow}>
                <Text style={styles.statLabel}>Weakness</Text>
                <View style={styles.statValue}>
                  <EnergyIcon type={weakness.type} />
                  <Text style={styles.statText}>{weakness.value}</Text>
                </View>
              </View>
            ))}
            {card.retreat !== null ? (
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Retreat</Text>
                <View style={styles.statValue}>
                  {card.retreat === 0 ? (
                    <Text style={styles.statText}>0</Text>
                  ) : (
                    Array.from({ length: card.retreat }, (_, index) => (
                      <Ionicons color={shopColors.text} key={index} name="star" size={16} />
                    ))
                  )}
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {card.attacks.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Attacks</Text>
            {card.attacks.map((attack, index) => {
              const open = openAttack === index;
              return (
                <Pressable
                  accessibilityRole="button"
                  key={`${attack.name}-${index}`}
                  onPress={() => setOpenAttack(open ? null : index)}
                  style={styles.attack}
                >
                  <View style={styles.attackTop}>
                    <View style={styles.cost}>
                      {attack.cost.map((energy, energyIndex) => (
                        <EnergyIcon key={`${energy}-${energyIndex}`} type={energy} />
                      ))}
                    </View>
                    <Text style={styles.attackName}>{attack.name}</Text>
                    <Text style={styles.attackDamage}>{attack.damage ?? ""}</Text>
                    <Ionicons
                      color={shopColors.muted}
                      name={open ? "chevron-up" : "chevron-down"}
                      size={16}
                    />
                  </View>
                  {open && attack.effect ? <Text style={styles.attackEffect}>{attack.effect}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Set details</Text>
            {card.set.id ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  router.replace({
                    pathname: "/shop/set",
                    params: { setId: card.set.id, name: card.set.name },
                  });
                }}
                style={styles.openSet}
              >
                <Text style={styles.openSetLabel}>Open set</Text>
                <Ionicons color="#FFFFFF" name="open-outline" size={14} />
              </Pressable>
            ) : null}
          </View>
          <View style={styles.setRow}>
            {card.set.logoUrl ? (
              <Image
                accessibilityIgnoresInvertColors
                contentFit="contain"
                source={{ uri: card.set.logoUrl }}
                style={styles.setLogo}
              />
            ) : (
              <View style={styles.setMark}>
                <Ionicons color={shopColors.text} name="star" size={18} />
              </View>
            )}
            <View style={styles.setCopy}>
              {card.set.serieName ? <Text style={styles.setSerie}>{card.set.serieName}</Text> : null}
              <Text style={styles.setName}>{card.set.name}</Text>
            </View>
          </View>
          {releaseDate ? (
            <View style={styles.release}>
              <Text style={styles.muted}>Release date</Text>
              <Text style={styles.releaseDate}>{releaseDate}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.marketTitle}>View card on marketplaces</Text>
        <Pressable
          accessibilityLabel="Buy on TCGPlayer"
          accessibilityRole="link"
          onPress={() =>
            void openUrl(
              tcgplayerUrl({
                name: card.name,
                localId: card.localId,
                setName: card.set.name,
                tcgplayerProductId: card.tcgplayerProductId,
              }),
            )
          }
          style={styles.market}
        >
          <Text style={styles.tcgWordmark}>
            <Text style={styles.tcgDark}>TCG</Text>
            <Text style={styles.tcgBlue}>PLAYER</Text>
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Buy on eBay"
          accessibilityRole="link"
          onPress={() =>
            void openUrl(
              ebayUrl({ name: card.name, localId: card.localId, setName: card.set.name }),
            )
          }
          style={styles.market}
        >
          <Text style={styles.ebayWordmark}>
            <Text style={styles.ebayRed}>e</Text>
            <Text style={styles.ebayBlue}>b</Text>
            <Text style={styles.ebayYellow}>a</Text>
            <Text style={styles.ebayGreen}>y</Text>
          </Text>
        </Pressable>
        <Text style={styles.disclaimer}>Opens the marketplace listing.</Text>
        {linkError ? <Text style={styles.linkError}>{linkError}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function EnergyIcon({ type }: { type: string }) {
  const icon = TYPE_ICON[type];
  const color = TYPE_COLOR[type] ?? "#A8A878";
  const glyph = color === "#F8D030" || color === "#B8B8D0" || color === "#EE99AC" || color === "#A8A878"
    ? "#1A1A1A"
    : "#FFFFFF";
  return (
    <View style={[styles.energy, { backgroundColor: color }]}>
      {icon ? (
        <Ionicons color={glyph} name={icon} size={11} />
      ) : (
        <Text style={[styles.energyLetter, { color: glyph }]}>{type.slice(0, 1)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: shopColors.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: shopSpace.sm,
    backgroundColor: shopColors.bg,
  },
  header: {
    minHeight: 56,
    paddingHorizontal: shopSpace.md,
    flexDirection: "row",
    alignItems: "center",
    gap: shopSpace.sm,
  },
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: shopColors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: shopColors.text,
    fontSize: 22,
    fontWeight: "800",
  },
  content: { padding: shopSpace.md, paddingBottom: 40, gap: shopSpace.md },
  priceRow: { flexDirection: "row", gap: shopSpace.md, alignItems: "stretch" },
  hero: {
    width: "42%",
    aspectRatio: 0.72,
    borderRadius: 14,
    backgroundColor: "#E4E4EA",
  },
  priceBox: {
    flex: 1,
    backgroundColor: shopColors.blueSoft,
    borderRadius: 16,
    padding: shopSpace.md,
    justifyContent: "center",
    gap: 4,
  },
  variantRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  variant: { color: shopColors.muted, fontSize: 15, fontWeight: "700" },
  variantSelected: { color: shopColors.blue },
  price: { color: shopColors.text, fontSize: 32, fontWeight: "800" },
  estimateLabel: { color: shopColors.muted, fontSize: 13, fontWeight: "700" },
  identity: { flexDirection: "row", alignItems: "center", gap: shopSpace.sm },
  localId: { color: shopColors.text, fontSize: 28, fontWeight: "800" },
  rarityPill: {
    backgroundColor: "#ECECF1",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  rarityText: { color: shopColors.muted, fontSize: 13, fontWeight: "700" },
  identitySpacer: { flex: 1 },
  illustrator: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "40%" },
  illustratorText: { color: shopColors.text, fontSize: 14, fontWeight: "700" },
  dexLine: { color: shopColors.muted, fontSize: 16, fontWeight: "700" },
  dexName: { color: shopColors.text, textDecorationLine: "underline" },
  section: {
    backgroundColor: shopColors.card,
    borderRadius: 18,
    padding: shopSpace.md,
    gap: shopSpace.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: shopSpace.sm,
  },
  sectionTitle: { color: shopColors.text, fontSize: 20, fontWeight: "800" },
  chart: { height: 36, justifyContent: "flex-end" },
  chartLine: { height: 2, backgroundColor: shopColors.line, borderRadius: 1 },
  chartDot: {
    position: "absolute",
    right: 8,
    bottom: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: shopColors.blue,
  },
  chartLabels: { flexDirection: "row", justifyContent: "space-between" },
  today: { color: shopColors.text, fontSize: 13, fontWeight: "700" },
  muted: { color: shopColors.muted, fontSize: 14 },
  disclaimer: { color: shopColors.muted, fontSize: 12, lineHeight: 17 },
  companyRow: { flexDirection: "row", gap: shopSpace.sm },
  companyBlock: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderWidth: 1,
    borderColor: shopColors.line,
    borderRadius: 12,
    paddingVertical: 8,
  },
  companyBlockOpen: { backgroundColor: shopColors.blueSoft, borderColor: shopColors.blue },
  companyText: { color: shopColors.text, fontSize: 13, fontWeight: "800" },
  gradeRow: { flexDirection: "row", alignItems: "center", gap: shopSpace.sm },
  gradeBadge: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  gradeCompany: { color: shopColors.muted, fontSize: 10, fontWeight: "800" },
  gradeNumber: { color: shopColors.text, fontSize: 18, fontWeight: "800" },
  gradeLabel: { flex: 1 },
  gradePrice: { color: shopColors.text, fontSize: 16, fontWeight: "800", minWidth: 72, textAlign: "right" },
  gradeMissing: { color: shopColors.muted },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: shopSpace.sm,
  },
  statLabel: { color: shopColors.text, fontSize: 16, fontWeight: "700" },
  statValue: { flexDirection: "row", alignItems: "center", gap: 6 },
  statText: { color: shopColors.text, fontSize: 16, fontWeight: "800" },
  attack: { backgroundColor: shopColors.attack, borderRadius: 14, padding: shopSpace.sm, gap: 6 },
  attackTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  cost: { flexDirection: "row", gap: 4 },
  attackName: { flex: 1, color: shopColors.text, fontSize: 16, fontWeight: "700" },
  attackDamage: { color: shopColors.text, fontSize: 16, fontWeight: "800" },
  attackEffect: { color: shopColors.muted, fontSize: 13, lineHeight: 18 },
  energy: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  energyLetter: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  openSet: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: shopColors.blue,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  openSetLabel: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  setRow: { flexDirection: "row", alignItems: "center", gap: shopSpace.sm },
  setLogo: { width: 54, height: 36 },
  setMark: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: shopColors.attack,
    alignItems: "center",
    justifyContent: "center",
  },
  setCopy: { flex: 1, gap: 2 },
  setSerie: { color: shopColors.text, fontSize: 16, fontWeight: "800" },
  setName: { color: shopColors.muted, fontSize: 14, fontWeight: "600" },
  release: { gap: 2, paddingTop: shopSpace.xs },
  releaseDate: { color: shopColors.text, fontSize: 16, fontWeight: "800" },
  marketTitle: { color: shopColors.muted, fontSize: 16, fontWeight: "600" },
  market: {
    backgroundColor: shopColors.card,
    borderRadius: 16,
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  tcgWordmark: { fontSize: 22, fontWeight: "900", letterSpacing: 0.4 },
  tcgDark: { color: "#111111" },
  tcgBlue: { color: "#1A73E8" },
  ebayWordmark: { fontSize: 32, fontWeight: "800" },
  ebayRed: { color: "#E53238" },
  ebayBlue: { color: "#0064D2" },
  ebayYellow: { color: "#F5AF02" },
  ebayGreen: { color: "#86B817" },
  linkError: { color: "#C2410C", fontSize: 14 },
  retry: {
    backgroundColor: shopColors.text,
    borderRadius: 14,
    paddingHorizontal: shopSpace.md,
    paddingVertical: shopSpace.sm,
  },
  retryLabel: { color: "#FFFFFF", fontWeight: "800" },
});
