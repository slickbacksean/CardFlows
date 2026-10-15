import {
  COST_MISSING_LABEL,
  formatPnlMoney,
  parseDollarsToCents,
  PNL_ESTIMATE_NOTE,
  pnlCsv,
  pnlRow,
  pnlTotals,
  type PnlRow,
} from "@cardflow/shared";
import * as Clipboard from "expo-clipboard";
import { Stack, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { getDraft, listInventory } from "@/lib/api";
import { peekMaxBuyPreferences } from "@/lib/preferences";
import { loadSales, migrateLocalSales, saveSale, type SaleRecord } from "@/lib/sales";
import { colors, radii, space } from "@/lib/theme";

interface Entry {
  row: PnlRow;
  sale: SaleRecord | null;
}

async function loadEntries(): Promise<{ entries: Entry[]; offline: boolean }> {
  const { items } = await listInventory();
  const feesBufferPct = peekMaxBuyPreferences().feesBufferPct;
  const purchased = items.filter((item) => item.intent === "purchased");
  await migrateLocalSales(purchased.map((item) => item.inventoryItemId)).catch(() => 0);
  const { sales, offline } = await loadSales();
  const entries = await Promise.all(
    purchased.map(async (item) => {
      const sale = sales.get(item.inventoryItemId) ?? null;
      let askingPrice: string | null = null;
      if (!sale && item.draft?.draftId) {
        try {
          askingPrice = (await getDraft(item.draft.draftId)).draft.askingPrice?.trim() || null;
        } catch {
          askingPrice = null;
        }
      }
      const row = pnlRow({
        inventoryItemId: item.inventoryItemId,
        name: item.card?.name?.trim() || item.draft?.title?.trim() || "Card",
        allInTotal: item.purchase?.costBasis.allInTotal ?? null,
        sale,
        askingPrice,
        referencePrice: item.referencePriceAmount,
        feesBufferPct,
      });
      return { row, sale };
    }),
  );
  return { entries, offline };
}

export default function PnlScreen() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const loaded = await loadEntries();
      setEntries(loaded.entries);
      setError(loaded.offline ? "Offline. Showing sales saved on this phone; they sync when you reconnect." : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the collection");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const rows = entries.map((entry) => entry.row);
  const totals = pnlTotals(rows);

  async function exportCsv() {
    const csv = pnlCsv(rows);
    try {
      const result = await Share.share({ message: csv, title: "CardFlow P&L" });
      if (result.action !== Share.dismissedAction) setNotice(`Shared ${rows.length} cards.`);
    } catch {
      await Clipboard.setStringAsync(csv);
      setNotice(`Copied ${rows.length} cards.`);
    }
  }

  async function recordSale(inventoryItemId: string, sale: SaleRecord | null) {
    await saveSale(inventoryItemId, sale);
    await refresh();
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.flex}>
      <Stack.Screen options={{ title: "P&L" }} />
      <View style={styles.summary}>
        <Text style={styles.label}>Realized net · {totals.realizedCount} sold</Text>
        <Text style={styles.big}>{formatPnlMoney(totals.realizedNetCents)}</Text>
        <Text style={styles.label}>Estimated net · {totals.estimatedCount} unsold</Text>
        <Text style={styles.mid}>{formatPnlMoney(totals.estimatedNetCents)}</Text>
        {totals.costMissingCount > 0 ? (
          <Text style={styles.warn}>
            {COST_MISSING_LABEL} on {totals.costMissingCount} cards. They are left out of the totals.
          </Text>
        ) : null}
        <Text style={styles.muted}>{PNL_ESTIMATE_NOTE}</Text>
      </View>
      <Pressable accessibilityRole="button" disabled={rows.length === 0} onPress={() => void exportCsv()} style={styles.button}>
        <Text style={styles.buttonText}>Share P&L spreadsheet</Text>
      </Pressable>
      {loading ? <ActivityIndicator color={colors.accent} /> : null}
      {entries.map((entry) => (
        <PnlCard entry={entry} key={entry.row.inventoryItemId} onSave={recordSale} />
      ))}
      {!loading && entries.length === 0 ? <Text style={styles.muted}>No purchased cards yet.</Text> : null}
      {notice ? <Text style={styles.muted}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

function PnlCard({
  entry,
  onSave,
}: {
  entry: Entry;
  onSave: (id: string, sale: SaleRecord | null) => Promise<void>;
}) {
  const { row, sale } = entry;
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(sale?.price ?? "");
  const [fees, setFees] = useState(sale?.fees ?? "");
  const [inputError, setInputError] = useState<string | null>(null);

  async function save() {
    if (parseDollarsToCents(price) === null || (fees.trim() && parseDollarsToCents(fees) === null)) {
      setInputError("Enter a valid price.");
      return;
    }
    setInputError(null);
    await onSave(row.inventoryItemId, { price: price.trim(), fees: fees.trim() || null, soldAt: new Date().toISOString() });
    setEditing(false);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{row.name}</Text>
      <Text style={styles.muted}>
        {row.statusLabel} · All-in {row.costLabel}
        {row.priceCents !== null ? ` · Price ${formatPnlMoney(row.priceCents)}` : ""}
        {row.feesCents !== null ? ` · Fees ${formatPnlMoney(row.feesCents)}` : ""}
      </Text>
      <Text style={styles.mid}>Net {row.netLabel}</Text>
      {editing ? (
        <View style={styles.form}>
          <TextInput accessibilityLabel="Sale price" keyboardType="decimal-pad" onChangeText={setPrice} placeholder="Sale price" placeholderTextColor={colors.muted} style={styles.input} value={price} />
          <TextInput accessibilityLabel="Sale fees" keyboardType="decimal-pad" onChangeText={setFees} placeholder="Fees (optional)" placeholderTextColor={colors.muted} style={styles.input} value={fees} />
          {inputError ? <Text style={styles.error}>{inputError}</Text> : null}
          <Pressable accessibilityRole="button" onPress={() => void save()} style={styles.button}>
            <Text style={styles.buttonText}>Save sale</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={() => setEditing(true)}>
            <Text style={styles.link}>{sale ? "Edit sale" : "Record sale"}</Text>
          </Pressable>
          {sale ? (
            <Pressable accessibilityRole="button" onPress={() => void onSave(row.inventoryItemId, null)}>
              <Text style={styles.link}>Undo sale</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: 48, gap: space.md },
  summary: { backgroundColor: colors.card, borderRadius: radii.lg, padding: space.md, gap: 4 },
  label: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  big: { color: colors.text, fontSize: 28, fontWeight: "800" },
  mid: { color: colors.text, fontSize: 17, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  warn: { color: colors.danger, fontSize: 13, fontWeight: "700" },
  error: { color: colors.danger, fontSize: 14 },
  card: { backgroundColor: colors.card, borderColor: colors.cardBorder, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: space.md, gap: 4 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  form: { gap: space.sm, marginTop: space.sm },
  input: { borderColor: colors.cardBorder, borderWidth: 1, borderRadius: radii.md, color: colors.text, padding: space.sm },
  actions: { flexDirection: "row", gap: space.md, marginTop: 4 },
  link: { color: colors.accent, fontWeight: "700" },
  button: { backgroundColor: colors.accent, borderRadius: radii.pill, padding: space.md, alignItems: "center" },
  buttonText: { color: colors.accentText, fontWeight: "800" },
});
