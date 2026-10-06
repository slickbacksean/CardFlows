import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SearchField } from "@/components/shop/search-field";
import { shopColors, shopSpace } from "@/components/shop/shop-theme";
import { withPriceEstimates, withRarities, type ShopCardBrief } from "@/lib/shop-catalog";

interface PrintBrowserProps {
  title: string;
  cards: ShopCardBrief[];
  status: "loading" | "ready" | "error";
  onRetry: () => void;
  ownedIds: ReadonlySet<string>;
  onBack: () => void;
  onOpenCard: (cardId: string) => void;
}

const RARITY_RANK = [
  "Common",
  "Uncommon",
  "Rare",
  "Rare Holo",
  "Double Rare",
  "Ultra Rare",
  "Illustration Rare",
  "Special Illustration Rare",
  "Hyper Rare",
  "Promo",
];

export function PrintBrowser({
  title,
  cards,
  status,
  onRetry,
  ownedIds,
  onBack,
  onOpenCard,
}: PrintBrowserProps) {
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [amounts, setAmounts] = useState<Record<string, number | null>>({});
  const [rarityById, setRarityById] = useState<Record<string, string | null>>({});
  const [priceSort, setPriceSort] = useState<"off" | "loading" | "on">("off");
  const [ownershipOn, setOwnershipOn] = useState(false);
  const [rarity, setRarity] = useState<string | null>(null);
  const [rarityOpen, setRarityOpen] = useState(false);
  const [raritiesLoading, setRaritiesLoading] = useState(false);

  const listed = useMemo(
    () =>
      cards.map((card) => ({
        ...card,
        amountCents: card.id in amounts ? amounts[card.id] : card.amountCents,
        rarity: card.id in rarityById ? rarityById[card.id] : card.rarity,
      })),
    [amounts, cards, rarityById],
  );
  const tileWidth = (width - shopSpace.md * 2 - shopSpace.sm * 2) / 3;
  const rarities = useMemo(() => uniqueRarities(listed), [listed]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let next = listed;
    if (needle) {
      next = next.filter((card) =>
        `${card.name} ${card.localId} ${card.rarity ?? ""}`.toLowerCase().includes(needle),
      );
    }
    if (ownershipOn) next = next.filter((card) => ownedIds.has(card.id));
    if (rarity) next = next.filter((card) => card.rarity === rarity);
    if (priceSort === "on") {
      next = [...next].sort(
        (left, right) => (right.amountCents ?? -1) - (left.amountCents ?? -1),
      );
    }
    return next;
  }, [listed, ownershipOn, ownedIds, priceSort, query, rarity]);

  async function togglePriceSort() {
    if (priceSort === "loading") return;
    if (priceSort === "on") {
      setPriceSort("off");
      return;
    }
    setPriceSort("loading");
    const priced = await withPriceEstimates(listed);
    setAmounts((current) => {
      const next = { ...current };
      for (const card of priced) next[card.id] = card.amountCents ?? null;
      return next;
    });
    setPriceSort("on");
  }

  async function toggleRarity() {
    if (rarityOpen) {
      setRarityOpen(false);
      setRarity(null);
      return;
    }
    setRarityOpen(true);
    if (listed.every((card) => card.rarity !== undefined)) return;
    setRaritiesLoading(true);
    const hydrated = await withRarities(listed);
    setRarityById((current) => {
      const next = { ...current };
      for (const card of hydrated) next[card.id] = card.rarity ?? null;
      return next;
    });
    setRaritiesLoading(false);
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.circle}
        >
          <Ionicons color={shopColors.text} name="chevron-back" size={22} />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        <View style={styles.circleSpacer} />
      </View>
      <View style={styles.searchPad}>
        <SearchField onChangeText={setQuery} placeholder="Search cards..." value={query} />
      </View>
      <ScrollView
        contentContainerStyle={styles.chips}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroller}
      >
        <FilterChip active icon="flag-outline" label="English" />
        <FilterChip
          active={priceSort === "on"}
          icon="pricetag-outline"
          label={priceSort === "loading" ? "Pricing…" : "Top priced"}
          onPress={() => void togglePriceSort()}
        />
        <FilterChip
          active={ownershipOn}
          icon="checkmark-circle-outline"
          label="Ownership"
          onPress={() => setOwnershipOn((current) => !current)}
        />
        <FilterChip
          active={rarityOpen}
          icon="sparkles-outline"
          label="Rarity"
          onPress={() => void toggleRarity()}
        />
      </ScrollView>
      {rarityOpen ? (
        <ScrollView
          contentContainerStyle={styles.chips}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroller}
        >
          {raritiesLoading ? <ActivityIndicator color={shopColors.text} /> : null}
          {rarities.map((name) => (
            <FilterChip
              active={rarity === name}
              key={name}
              label={name}
              onPress={() => setRarity((current) => (current === name ? null : name))}
            />
          ))}
        </ScrollView>
      ) : null}
      {status === "loading" ? (
        <View style={styles.center}>
          <ActivityIndicator color={shopColors.text} />
        </View>
      ) : null}
      {status === "error" ? (
        <View style={styles.center}>
          <Text style={styles.message}>Could not load these cards.</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {status === "ready" ? (
        <FlatList
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          data={visible}
          keyExtractor={(card) => card.id}
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            <Text style={styles.message}>
              {ownershipOn ? "None of these cards are in your collection." : "No cards match."}
            </Text>
          }
          numColumns={3}
          renderItem={({ item }) => (
            <Pressable
              accessibilityLabel={`${item.name} ${item.localId}`}
              accessibilityRole="button"
              onPress={() => onOpenCard(item.id)}
              style={[styles.frame, { width: tileWidth }]}
            >
              {item.imageUrl ? (
                <Image
                  accessibilityIgnoresInvertColors
                  cachePolicy="memory-disk"
                  contentFit="cover"
                  source={{ uri: item.imageUrl }}
                  style={styles.art}
                />
              ) : (
                <View style={styles.artFallback}>
                  <Text numberOfLines={2} style={styles.fallbackName}>
                    {item.name}
                  </Text>
                  <Text style={styles.fallbackNumber}>#{item.localId}</Text>
                </View>
              )}
              {ownedIds.has(item.id) ? (
                <View style={styles.owned}>
                  <Ionicons color="#FFFFFF" name="checkmark" size={12} />
                </View>
              ) : null}
            </Pressable>
          )}
        />
      ) : null}
    </SafeAreaView>
  );
}

interface FilterChipProps {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  active?: boolean;
  onPress?: () => void;
}

function FilterChip({ label, icon, active = false, onPress }: FilterChipProps) {
  const tint = active ? "#FFFFFF" : shopColors.text;
  const body = (
    <>
      {icon ? <Ionicons color={tint} name={icon} size={16} /> : null}
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </>
  );
  if (!onPress) {
    return (
      <View accessibilityLabel={label} style={[styles.chip, active && styles.chipActive]}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      {body}
    </Pressable>
  );
}

function uniqueRarities(cards: ShopCardBrief[]): string[] {
  const names = new Set<string>();
  for (const card of cards) {
    if (card.rarity) names.add(card.rarity);
  }
  return [...names].sort((left, right) => {
    const leftRank = RARITY_RANK.indexOf(left);
    const rightRank = RARITY_RANK.indexOf(right);
    if (leftRank === -1 && rightRank === -1) return left.localeCompare(right);
    if (leftRank === -1) return 1;
    if (rightRank === -1) return -1;
    return leftRank - rightRank;
  });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: shopColors.bg },
  header: {
    minHeight: 52,
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
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  circleSpacer: { width: 40 },
  title: {
    flex: 1,
    textAlign: "center",
    color: shopColors.text,
    fontSize: 22,
    fontWeight: "800",
  },
  searchPad: { paddingHorizontal: shopSpace.md, paddingBottom: shopSpace.sm },
  chipScroller: { flexGrow: 0, flexShrink: 0, height: 64 },
  chips: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: shopSpace.md,
    height: 64,
    gap: shopSpace.sm,
  },
  chip: {
    flexDirection: "row",
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    height: 44,
    backgroundColor: shopColors.card,
    borderRadius: 22,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#C5C5CE",
  },
  chipActive: {
    backgroundColor: shopColors.blue,
    borderColor: shopColors.blue,
  },
  chipLabel: { color: shopColors.text, fontSize: 15, fontWeight: "700", flexShrink: 0 },
  chipLabelActive: { color: "#FFFFFF" },
  grid: { paddingHorizontal: shopSpace.md, paddingBottom: shopSpace.lg, gap: shopSpace.sm },
  row: { gap: shopSpace.sm },
  frame: {
    borderWidth: 3,
    borderColor: shopColors.gold,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#E4E4EA",
  },
  art: { width: "100%", aspectRatio: 0.72 },
  artFallback: {
    width: "100%",
    aspectRatio: 0.72,
    alignItems: "center",
    justifyContent: "center",
    padding: shopSpace.sm,
    gap: 4,
  },
  fallbackName: { color: shopColors.text, fontSize: 12, fontWeight: "800", textAlign: "center" },
  fallbackNumber: { color: shopColors.muted, fontSize: 11, fontWeight: "700" },
  owned: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: shopColors.owned,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: shopSpace.sm },
  message: {
    color: shopColors.muted,
    fontSize: 15,
    textAlign: "center",
    padding: shopSpace.lg,
  },
  retry: {
    backgroundColor: shopColors.text,
    borderRadius: 14,
    paddingHorizontal: shopSpace.md,
    paddingVertical: shopSpace.sm,
  },
  retryLabel: { color: "#FFFFFF", fontWeight: "800" },
});
