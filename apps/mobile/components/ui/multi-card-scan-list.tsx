import { ENGLISH_CARDS_ONLY_NOTE, type CardFlowCanonicalCard } from "@cardflow/shared";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "@/components/ui/primary-button";
import { colors, space } from "@/lib/theme";

export type MultiCardRow = {
  index: number;
  state: string;
  notice: string | null;
  countsTowardAllowance: boolean;
  confidence: string | null;
  mapping: {
    status: string;
    confidence?: string;
    canonicalCard: CardFlowCanonicalCard | null;
    candidates: CardFlowCanonicalCard[];
    userConfirmation?: { recommendedUx: string };
  };
};

/**
 * List/carousel of cards found in one scan photo. Each row has Confirm / Skip.
 * Non-English rows show ENGLISH_CARDS_ONLY_NOTE and Skip only.
 */
export function MultiCardScanList(props: {
  cards: MultiCardRow[];
  activeIndex: number;
  onSelectIndex: (index: number) => void;
  selectedTcgdexId: string | null;
  onSelectTcgdexId: (id: string) => void;
  isBusy: boolean;
  error: string | null;
  onConfirm: () => void;
  onSkip: () => void;
}) {
  const active = props.cards[props.activeIndex] ?? props.cards[0];
  if (!active) return null;
  const options = active.mapping.canonicalCard
    ? [active.mapping.canonicalCard, ...active.mapping.candidates]
    : active.mapping.candidates;
  const unsupported = Boolean(active.notice) || !active.countsTowardAllowance;
  const done = active.state === "confirmed" || active.state === "skipped";

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>
        {props.cards.length} cards in this photo
      </Text>
      <View style={styles.tabs}>
        {props.cards.map((card) => (
          <Pressable
            key={card.index}
            accessibilityRole="button"
            accessibilityLabel={`Card ${card.index + 1}${card.state !== "pending" ? `, ${card.state}` : ""}`}
            onPress={() => props.onSelectIndex(card.index)}
            style={[styles.tab, props.activeIndex === card.index && styles.tabActive]}
          >
            <Text style={styles.tabText}>{card.index + 1}</Text>
          </Pressable>
        ))}
      </View>

      {active.notice ? <Text style={styles.notice}>{active.notice}</Text> : null}
      {!active.notice && unsupported ? (
        <Text style={styles.notice}>{ENGLISH_CARDS_ONLY_NOTE}</Text>
      ) : null}

      {options.length > 0 && !unsupported ? (
        <View style={styles.options}>
          {options.map((card) => {
            const selected = props.selectedTcgdexId === card.tcgdexId;
            return (
              <Pressable
                key={card.tcgdexId}
                accessibilityRole="button"
                onPress={() => props.onSelectTcgdexId(card.tcgdexId)}
                style={[styles.option, selected && styles.optionSelected]}
              >
                <Text style={styles.optionTitle}>{card.name}</Text>
                <Text style={styles.optionMeta}>
                  {card.set.name} · #{card.localId}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {props.error ? <Text style={styles.error}>{props.error}</Text> : null}

      {done ? (
        <Text style={styles.done}>
          {active.state === "confirmed" ? "Confirmed" : "Skipped"}
        </Text>
      ) : (
        <View style={styles.actions}>
          {!unsupported ? (
            <PrimaryButton
              disabled={props.isBusy || !props.selectedTcgdexId}
              label={props.isBusy ? "Confirming…" : "Confirm"}
              onPress={props.onConfirm}
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={props.isBusy}
            onPress={props.onSkip}
            style={styles.skip}
          >
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  title: { color: colors.text, fontSize: 18, fontWeight: "600" },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tab: {
    minWidth: 36,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.card,
  },
  tabActive: { backgroundColor: colors.accent },
  tabText: { color: colors.text, fontWeight: "600" },
  notice: { color: colors.text, fontSize: 15 },
  options: { gap: space.sm },
  option: {
    padding: space.md,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  optionSelected: { borderWidth: 2, borderColor: colors.accent },
  optionTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  optionMeta: { color: colors.muted, marginTop: 4 },
  error: { color: colors.danger },
  actions: { gap: space.sm },
  skip: { alignItems: "center", padding: space.md },
  skipText: { color: colors.muted, fontSize: 16 },
  done: { color: colors.muted, fontSize: 15 },
});
