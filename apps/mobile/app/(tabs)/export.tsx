import { listPurchasedDraftsForCopy, listingDraftStatusLabel } from "@cardflow/shared";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { listInventory, type InventoryItem } from "@/lib/api";
import { pushCopyListing } from "@/lib/copy-listing";
import { colors, space } from "@/lib/theme";

export default function ExportScreen() {
  const router = useRouter();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);

  const refreshInventory = useCallback(async () => {
    try {
      const result = await listInventory();
      setItems(result.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load listings");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshInventory();
    }, [refreshInventory]),
  );

  const readyRows = useMemo(() => listPurchasedDraftsForCopy(items), [items]);

  async function openCopyListing() {
    if (isOpening) return;
    setIsOpening(true);
    setError(null);
    try {
      const result = await listInventory();
      setItems(result.items);
      pushCopyListing(router, result.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open listing");
    } finally {
      setIsOpening(false);
    }
  }

  function openDraft(draftId: string) {
    router.push(`/draft/${draftId}`);
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.flex}>
      <Text style={styles.title}>Export</Text>
      <Text style={styles.constraint}>
        Clipboard copy omits private notes. CardFlow did not publish this.
      </Text>

      <View style={styles.list}>
        <DestinationRow
          label="Copy listing"
          meta="on listing draft"
          onPress={() => void openCopyListing()}
          showChevron
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {readyRows.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.sectionTitle}>Ready to copy</Text>
          {readyRows.map((row) => (
            <DestinationRow
              key={row.draftId}
              label={row.label}
              meta={listingDraftStatusLabel(row.status)}
              onPress={() => openDraft(row.draftId)}
              showChevron
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

interface DestinationRowProps {
  label: string;
  meta: string;
  disabled?: boolean;
  showChevron?: boolean;
  onPress?: () => void;
}

function DestinationRow({
  label,
  meta,
  disabled = false,
  showChevron = false,
  onPress,
}: DestinationRowProps) {
  const body = (
    <>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowLabel, disabled && styles.rowLabelDisabled]}>{label}</Text>
        <Text style={styles.rowMeta}>{meta}</Text>
      </View>
      {showChevron && !disabled ? (
        <Ionicons color={colors.muted} name="chevron-forward" size={20} />
      ) : null}
    </>
  );

  if (disabled || !onPress) {
    return (
      <View
        accessibilityLabel={`${label}, ${meta}`}
        accessibilityState={disabled ? { disabled: true } : undefined}
        style={[styles.row, disabled && styles.rowDisabled]}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityLabel={`${label}, ${meta}`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.row}
    >
      {body}
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
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  constraint: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  list: { gap: space.sm },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  row: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  rowDisabled: { opacity: 0.55 },
  rowCopy: { flex: 1, gap: 2 },
  error: { color: colors.danger, fontSize: 14 },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: "700" },
  rowLabelDisabled: { color: colors.muted },
  rowMeta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
});
