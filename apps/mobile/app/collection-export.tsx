import {
  ebayListingCsv,
  renderListingTitle,
  tcgTraderCollectionCsv,
  descriptionStarter,
  type EbayListingExportRow,
  type TcgTraderExportRow,
} from "@cardflow/shared";
import { StatusBanner } from "@/components/ui/status-banner";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { Stack, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { getDraft, listInventory, type InventoryItem } from "@/lib/api";
import { colors, radii, space } from "@/lib/theme";

type Destination = "ebay" | "tcg";

function purchasedCopies(items: InventoryItem[]): InventoryItem[] {
  return items.filter((item) => item.intent === "purchased");
}

function quantityOf(item: InventoryItem): number {
  const quantity = item.quantity ?? 1;
  return quantity > 0 ? quantity : 1;
}

function tcgRow(item: InventoryItem): TcgTraderExportRow {
  return {
    name: item.card?.name?.trim() || item.draft?.title?.trim() || "Card",
    setName: item.card?.setName?.trim() ?? "",
    localId: item.card?.localId?.trim() ?? "",
    variant: item.selectedVariant ?? null,
    condition: item.condition ?? null,
    quantity: quantityOf(item),
  };
}

async function ebayRow(item: InventoryItem): Promise<EbayListingExportRow> {
  const card = item.card;
  const identity = {
    name: card?.name?.trim() || "Card",
    setName: card?.setName?.trim() ?? "",
    localId: card?.localId?.trim() ?? "",
    selectedVariant: item.selectedVariant ?? null,
    condition: item.condition ?? null,
  };
  let title = item.draft?.title?.trim() || renderListingTitle(identity);
  let description = descriptionStarter(identity);
  let condition = item.condition ?? null;
  let askingPrice: string | null = null;

  if (item.draft?.draftId) {
    try {
      const view = await getDraft(item.draft.draftId);
      title = view.draft.title.trim() || title;
      description = view.draft.description.trim() || description;
      condition = view.draft.condition ?? condition;
      askingPrice = view.draft.askingPrice?.trim() || null;
    } catch {
      // Keep the card identity when a draft cannot be loaded.
    }
  }

  return {
    title,
    description,
    condition,
    askingPrice,
    currency: "USD",
    quantity: quantityOf(item),
    setName: identity.setName,
    localId: identity.localId,
  };
}

async function handOff(csv: string, title: string): Promise<"shared" | "copied" | "dismissed"> {
  try {
    const result = await Share.share({ message: csv, title });
    if (result.action === Share.dismissedAction) return "dismissed";
    return "shared";
  } catch {
    await Clipboard.setStringAsync(csv);
    return "copied";
  }
}

export default function CollectionExportScreen() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Destination | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshInventory = useCallback(async () => {
    try {
      const result = await listInventory();
      setItems(result.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't load MyDEX");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshInventory();
    }, [refreshInventory]),
  );

  const purchased = useMemo(() => purchasedCopies(items), [items]);
  const countLabel = purchased.length === 1 ? "1 purchased card" : `${purchased.length} purchased cards`;

  async function shareDestination(destination: Destination) {
    if (busy || purchased.length === 0) return;
    setBusy(destination);
    setError(null);
    setNotice(null);
    try {
      const latest = await listInventory();
      setItems(latest.items);
      const copies = purchasedCopies(latest.items);
      if (copies.length === 0) {
        setNotice("No purchased cards to export.");
        return;
      }
      const ebayRows = destination === "ebay" ? await Promise.all(copies.map((item) => ebayRow(item))) : [];
      const csv =
        destination === "ebay"
          ? ebayListingCsv(ebayRows)
          : tcgTraderCollectionCsv(copies.map(tcgRow));
      const title = destination === "ebay" ? "eBay listings" : "TCG Trader collection";
      const result = await handOff(csv, title);
      if (result === "dismissed") return;
      const missingPrice = ebayRows.some((row) => !row.askingPrice);
      const priceNote = missingPrice ? " Cards without an asking price are left blank." : "";
      setNotice(
        result === "copied"
          ? `Copied ${copies.length} cards. Paste the sheet, then upload it yourself.${priceNote}`
          : `Shared ${copies.length} cards. Upload the file yourself. PokeSniper did not list them.${priceNote}`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't export");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.flex}>
      <Stack.Screen options={{ title: "Export CSV" }} />
      <Text style={styles.title}>Export CSV</Text>
      <StatusBanner />
      <Text style={styles.constraint}>
        Share purchased cards as a spreadsheet. You upload it. PokeSniper does not list them.
      </Text>

      {isLoading ? (
        <ActivityIndicator accessibilityLabel="Loading MyDEX" color={colors.accent} />
      ) : (
        <View style={styles.list}>
          <DestinationCard
            busy={busy === "ebay"}
            countLabel={countLabel}
            detail="Title, condition, and asking price. Paste into Seller Hub."
            disabled={purchased.length === 0 || busy !== null}
            label="eBay"
            onPress={() => void shareDestination("ebay")}
          />
          <DestinationCard
            busy={busy === "tcg"}
            countLabel={countLabel}
            detail="Name, set, number, condition, and quantity."
            disabled={purchased.length === 0 || busy !== null}
            label="TCG Trader"
            onPress={() => void shareDestination("tcg")}
          />
        </View>
      )}

      {purchased.length === 0 && !isLoading ? (
        <Text style={styles.constraint}>No purchased cards yet. Watchlist cards stay in the app.</Text>
      ) : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

interface DestinationCardProps {
  label: string;
  detail: string;
  countLabel: string;
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
}

function DestinationCard({
  label,
  detail,
  countLabel,
  disabled,
  busy,
  onPress,
}: DestinationCardProps) {
  return (
    <Pressable
      accessibilityLabel={`${label}, ${detail}, ${countLabel}`}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.row, disabled && styles.rowDisabled]}
    >
      <View style={styles.mark}>
        {busy ? (
          <ActivityIndicator color={colors.accentText} />
        ) : (
          <Ionicons color={colors.accentText} name="share-outline" size={18} />
        )}
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowMeta}>{detail}</Text>
        <Text style={styles.rowCount}>{countLabel}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: space.lg,
    paddingBottom: 48,
    gap: space.md,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  constraint: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  list: { gap: space.sm },
  row: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  rowDisabled: { opacity: 0.55 },
  mark: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCopy: { flex: 1, gap: 2 },
  rowLabel: { color: colors.text, fontSize: 17, fontWeight: "800", letterSpacing: -0.2 },
  rowMeta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  rowCount: { color: colors.text, fontSize: 13, fontWeight: "700", marginTop: 4 },
  notice: { color: colors.text, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14 },
});
