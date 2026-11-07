import {
  TRENDING_DISABLED_COPY,
  actionErrorMessage,
  formatSignedPercent,
  pricesAsOfLabel,
  SCREEN_EMPTY_COPY,
  SCREEN_ERROR_WHAT,
  SCREEN_LOADING_LABELS,
  screenDataState,
  type TrendingCard,
  type TrendingMoverCard,
  type TrendingPayload,
  type TrendingWindow,
} from "@cardflow/shared";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { CardTile } from "@/components/ui/card-tile";
import { PokemonTcgAttribution } from "@/components/ui/pokemontcg-attribution";
import { ScreenEmpty, ScreenError, ScreenLoading, StaleBanner } from "@/components/ui/screen-state";
import { StatusBanner } from "@/components/ui/status-banner";
import { getTrending } from "@/lib/api";
import { useTrendingEnabled } from "@/lib/feature-flags";
import { colors, radii, space, type } from "@/lib/theme";

type LoadState = "loading" | "ready" | "error";

function openCard(tcgdexId: string) {
  router.push({ pathname: "/shop/card", params: { cardId: tcgdexId } });
}

export default function TrendingScreen() {
  const trendingEnabled = useTrendingEnabled();
  const { width } = useWindowDimensions();
  const tileWidth = (width - space.md * 2 - space.sm * 2) / 3;
  const [window, setWindow] = useState<TrendingWindow>("24h");
  const [payload, setPayload] = useState<TrendingPayload | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getTrending(window);
      setPayload(next);
      setLoadState("ready");
      setLoadError(null);
      setLoadedAt(Date.now());
    } catch (caught) {
      setLoadError(caught);
      setLoadState("error");
    }
  }, [window]);

  useFocusEffect(
    useCallback(() => {
      if (!trendingEnabled) return;
      void refresh();
    }, [refresh, trendingEnabled]),
  );

  const dataState = screenDataState({ status: loadState, loadedAt });

  async function retryLoad() {
    if (retrying) return;
    setRetrying(true);
    if (loadedAt == null) setLoadState("loading");
    try {
      await refresh();
    } finally {
      setRetrying(false);
    }
  }

  if (!trendingEnabled) {
    return (
      <View style={styles.screen}>
        <ScreenEmpty
          title={SCREEN_EMPTY_COPY.trendingDisabled.title}
          body={SCREEN_EMPTY_COPY.trendingDisabled.body}
        />
      </View>
    );
  }

  if (dataState === "loading") {
    return <ScreenLoading label={SCREEN_LOADING_LABELS.trending} variant="grid" />;
  }

  if (dataState === "error") {
    return (
      <ScreenError
        error={loadError}
        what={SCREEN_ERROR_WHAT.trending}
        onRetry={() => void retryLoad()}
        retrying={retrying}
      />
    );
  }

  const empty =
    !payload ||
    (payload.popularity.cards.length === 0 && payload.movers.up.length === 0 && payload.movers.down.length === 0);

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <StatusBanner />
      {dataState === "stale" && loadedAt != null ? (
        <StaleBanner kind="prices" loadedAt={loadedAt} onRetry={() => void retryLoad()} retrying={retrying} />
      ) : null}
      <Text style={styles.heading}>Trending</Text>
      <View style={styles.chips}>
        {(["24h", "7d"] as const).map((value) => {
          const selected = window === value;
          return (
            <Pressable
              key={value}
              accessibilityLabel={value === "24h" ? "Last 24 hours" : "Last 7 days"}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setWindow(value)}
              style={[styles.chip, selected && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelActive]}>
                {value === "24h" ? "24 hours" : "7 days"}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {pricesAsOfLabel(payload?.pricesAsOf ?? payload?.snapshotDate) ? (
        <Text style={styles.asOf}>
          {pricesAsOfLabel(payload?.pricesAsOf ?? payload?.snapshotDate)}
          {payload?.stale ? " (may be stale)" : ""}
        </Text>
      ) : null}
      {empty ? (
        <ScreenEmpty title={SCREEN_EMPTY_COPY.trending.title} body={SCREEN_EMPTY_COPY.trending.body} />
      ) : (
        <>
          <Section title={payload?.popularity.sourceLabel ?? "Most popular"}>
            <View style={styles.grid}>
              {(payload?.popularity.cards ?? []).map((card) => (
                <PopularTile key={card.tcgdexId} card={card} width={tileWidth} />
              ))}
            </View>
          </Section>
          <Section title="Biggest movers up">
            {(payload?.movers.up ?? []).map((card) => (
              <MoverRow key={`${card.tcgdexId}-${card.variant}`} card={card} direction="up" />
            ))}
            {payload?.movers.up.length === 0 ? <Text style={styles.emptyLine}>No movers up in this window.</Text> : null}
          </Section>
          <Section title="Biggest movers down">
            {(payload?.movers.down ?? []).map((card) => (
              <MoverRow key={`${card.tcgdexId}-${card.variant}`} card={card} direction="down" />
            ))}
            {payload?.movers.down.length === 0 ? (
              <Text style={styles.emptyLine}>No movers down in this window.</Text>
            ) : null}
          </Section>
        </>
      )}
      <PokemonTcgAttribution />
      {loadError ? <Text style={styles.hidden}>{actionErrorMessage(loadError, TRENDING_DISABLED_COPY)}</Text> : null}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function PopularTile({ card, width }: { card: TrendingCard; width: number }) {
  const price = card.currentPriceUsd ? card.currentPriceUsd.replace(/^\$/, "") : null;
  return (
    <View style={{ width }}>
      <CardTile
        allInAmount={price}
        imageUrl={card.imageUrl}
        localId={card.localId}
        name={card.name}
        onPress={() => openCard(card.tcgdexId)}
      />
    </View>
  );
}

function MoverRow({ card, direction }: { card: TrendingMoverCard; direction: "up" | "down" }) {
  const tone = direction === "up" ? colors.success : colors.danger;
  return (
    <Pressable
      accessibilityLabel={`${card.name}, ${formatSignedPercent(card.changePercent)}, ${card.changeUsd}, now ${card.currentPriceUsd}`}
      accessibilityRole="button"
      onPress={() => openCard(card.tcgdexId)}
      style={styles.mover}
    >
      {card.imageUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          cachePolicy="memory-disk"
          contentFit="cover"
          source={{ uri: card.imageUrl }}
          style={styles.moverArt}
        />
      ) : (
        <View style={styles.moverArt} />
      )}
      <View style={styles.moverMeta}>
        <Text numberOfLines={1} style={styles.moverName}>
          {card.name}
        </Text>
        <Text numberOfLines={1} style={styles.moverSet}>
          {card.setName} · #{card.localId} · {card.variantLabel}
        </Text>
      </View>
      <View style={styles.moverPrices}>
        <Text style={[styles.moverPct, { color: tone }]}>{formatSignedPercent(card.changePercent)}</Text>
        <Text style={styles.moverChange}>{card.changeUsd}</Text>
        <Text style={styles.moverNow}>{card.currentPriceUsd}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.md, paddingBottom: space.lg * 2, gap: space.md },
  heading: { ...type.title, color: colors.text },
  chips: { flexDirection: "row", gap: space.sm },
  chip: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipLabel: { color: colors.text, fontSize: 14, fontWeight: "700" },
  chipLabelActive: { color: colors.accentText },
  asOf: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  section: { gap: space.sm },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  mover: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    padding: space.sm,
  },
  moverArt: {
    width: 52,
    height: 72,
    borderRadius: 8,
    backgroundColor: colors.chip,
  },
  moverMeta: { flex: 1, minWidth: 0, gap: 2 },
  moverName: { color: colors.text, fontSize: 15, fontWeight: "800" },
  moverSet: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  moverPrices: { alignItems: "flex-end", gap: 2 },
  moverPct: { fontSize: 15, fontWeight: "800" },
  moverChange: { color: colors.text, fontSize: 13, fontWeight: "700" },
  moverNow: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  emptyLine: { color: colors.muted, fontSize: 13 },
  hidden: { height: 0, opacity: 0 },
});
