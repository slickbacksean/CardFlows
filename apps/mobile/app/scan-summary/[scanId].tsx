import Ionicons from "@expo/vector-icons/Ionicons";
import {
  MULTI_CARD_SUMMARY_COPY,
  multiCardSkippedLabel,
  type MultiCardScanResult,
} from "@cardflow/shared";
import { Image } from "expo-image";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TcgplayerAttribution } from "@/components/ui/tcgplayer-attribution";
import { PrimaryButton } from "@/components/ui/primary-button";
import { getScan, listInventory, type ScanRecord } from "@/lib/api";
import { priceQueryOptions } from "@/lib/price-queries";
import { colors, space } from "@/lib/theme";
import { defaultVariantId } from "@/lib/variants";

export default function MultiCardScanSummaryScreen() {
  const router = useRouter();
  const { scanId: scanIdParam } = useLocalSearchParams<{ scanId: string }>();
  const scanId = Array.isArray(scanIdParam) ? scanIdParam[0] : scanIdParam;
  const [scan, setScan] = useState<ScanRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!scanId) {
        setError("Scan not found");
        return;
      }
      try {
        const data = await getScan(scanId);
        if (!cancelled) {
          setScan(data.scan);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Couldn't load summary");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  const confirmed = useMemo(
    () => (scan?.cardResults ?? []).filter((r) => r.state === "confirmed"),
    [scan],
  );
  const skippedCount = useMemo(
    () => (scan?.cardResults ?? []).filter((r) => r.state === "skipped").length,
    [scan],
  );

  const inventoryQuery = useQuery({
    queryKey: ["inventory", "multi-summary", scanId],
    queryFn: listInventory,
    staleTime: 15_000,
  });

  const purchasedByCardflowId = useMemo(() => {
    const map = new Map<string, true>();
    for (const item of inventoryQuery.data?.items ?? []) {
      if (item.intent === "purchased" && item.cardflowCardId) {
        map.set(item.cardflowCardId, true);
      }
    }
    return map;
  }, [inventoryQuery.data]);

  const priceQueries = useQueries({
    queries: confirmed.map((row) => {
      const card = row.mapping.canonicalCard;
      const tcgdexId = card?.tcgdexId ?? row.mapping.tcgdexId ?? "";
      const variant = card
        ? defaultVariantId(card.variants, card.selectedVariant)
        : "normal";
      return {
        ...priceQueryOptions(tcgdexId, variant),
        enabled: Boolean(tcgdexId),
      };
    }),
  });

  function openDecide(row: MultiCardScanResult) {
    const cardflowCardId = row.cardflowCardId;
    const confirmationId = row.confirmationId;
    if (!cardflowCardId || !confirmationId) return;
    router.push({
      pathname: "/decide/[cardflowCardId]",
      params: {
        cardflowCardId,
        confirmationId,
        scanId: scanId ?? "",
        confidence: row.confidence ?? row.mapping.confidence ?? "",
      },
    });
  }

  function onDone() {
    router.replace("/(tabs)/collection");
  }

  function onScanAnother() {
    router.replace("/capture");
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="Close"
          accessibilityRole="button"
          hitSlop={12}
          onPress={onDone}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="close" size={28} />
        </Pressable>
        <Text style={styles.topTitle}>{MULTI_CARD_SUMMARY_COPY.title}</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!scan && !error ? <Text style={styles.body}>Loading summary…</Text> : null}

        {scan && confirmed.length === 0 ? (
          <Text style={styles.body}>{MULTI_CARD_SUMMARY_COPY.emptyConfirmed}</Text>
        ) : null}

        {confirmed.map((row, i) => {
          const card = row.mapping.canonicalCard;
          const name = card?.name ?? "Card";
          const setName = card?.set.name ?? "";
          const number = card?.localId ?? "";
          const thumb = card?.image.constructedUrl ?? null;
          const purchased = row.cardflowCardId
            ? purchasedByCardflowId.has(row.cardflowCardId)
            : false;
          const price = priceQueries[i]?.data?.estimate?.amount ?? null;
          const maxBuyHint = price ? `Raw · $${price}` : null;

          return (
            <Pressable
              key={`${row.index}-${row.confirmationId ?? i}`}
              accessibilityLabel={`${name}. ${MULTI_CARD_SUMMARY_COPY.openDecide}`}
              accessibilityRole="button"
              onPress={() => openDecide(row)}
              style={styles.row}
            >
              {thumb ? (
                <Image
                  accessibilityIgnoresInvertColors
                  contentFit="contain"
                  source={{ uri: thumb }}
                  style={styles.thumb}
                />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]} />
              )}
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{name}</Text>
                <Text style={styles.rowMeta}>
                  {[setName, number ? `#${number}` : null].filter(Boolean).join(" · ")}
                </Text>
                {maxBuyHint ? <Text style={styles.rowMeta}>{maxBuyHint}</Text> : null}
                <Text style={purchased ? styles.purchased : styles.notPurchased}>
                  {purchased
                    ? MULTI_CARD_SUMMARY_COPY.purchased
                    : MULTI_CARD_SUMMARY_COPY.notPurchased}
                </Text>
              </View>
              <Ionicons color={colors.muted} name="chevron-forward" size={20} />
            </Pressable>
          );
        })}

        {priceQueries.some((q) => q.data?.estimate?.amount) ? <TcgplayerAttribution /> : null}

        {skippedCount > 0 ? (
          <Text style={styles.skipped}>{multiCardSkippedLabel(skippedCount)}</Text>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={MULTI_CARD_SUMMARY_COPY.done} onPress={onDone} />
        <Pressable accessibilityRole="button" onPress={onScanAnother} style={styles.secondary}>
          <Text style={styles.secondaryText}>{MULTI_CARD_SUMMARY_COPY.scanAnother}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  topTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  content: { padding: space.md, gap: space.sm, paddingBottom: space.lg },
  body: { color: colors.muted, fontSize: 15 },
  error: { color: colors.danger, fontSize: 15 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: space.md,
  },
  thumb: { width: 56, height: 78, borderRadius: 6, backgroundColor: colors.elevated },
  thumbEmpty: { borderWidth: 1, borderColor: colors.cardBorder },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  rowMeta: { color: colors.muted, fontSize: 13 },
  purchased: { color: colors.success, fontSize: 13, fontWeight: "600", marginTop: 4 },
  notPurchased: { color: colors.muted, fontSize: 13, marginTop: 4 },
  skipped: { color: colors.muted, fontSize: 14, marginTop: space.sm },
  footer: { padding: space.md, gap: space.sm },
  secondary: { alignItems: "center", padding: space.md },
  secondaryText: { color: colors.muted, fontSize: 16 },
});
