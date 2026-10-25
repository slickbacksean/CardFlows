import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { PrimaryButton } from "@/components/ui/primary-button";
import { listInventory } from "@/lib/api";
import { colors, radii, space } from "@/lib/theme";

export default function ExportDataScreen() {
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function exportData(format: "csv" | "json") {
    setExporting(true);
    setError(null);
    setSuccess(null);

    try {
      // Get all inventory data
      const result = await listInventory();
      
      let content: string;
      let filename: string;

      if (format === "json") {
        content = JSON.stringify(result, null, 2);
        filename = `pokesniper-data-${new Date().toISOString().split("T")[0]}.json`;
      } else {
        // Convert to CSV
        const headers = ["Card Name", "Set", "Number", "Intent", "Condition", "Quantity", "Created At"];
        const rows = result.items.map((item) => [
          item.card?.name || "",
          item.card?.setName || "",
          item.card?.localId || "",
          item.intent,
          item.condition || "",
          item.quantity?.toString() || "1",
          item.createdAt,
        ]);
        
        const csvContent = [
          headers.join(","),
          ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
        ].join("\n");

        content = csvContent;
        filename = `pokesniper-data-${new Date().toISOString().split("T")[0]}.csv`;
      }

      // Try to share
      try {
        const shareResult = await Share.share({ message: content, title: filename });
        if (shareResult.action !== Share.dismissedAction) {
          setSuccess(`Exported ${result.items.length} items as ${format.toUpperCase()}`);
        }
      } catch (shareError) {
        // Fallback to clipboard
        await Clipboard.setStringAsync(content);
        setSuccess(`Copied ${result.items.length} items to clipboard`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <PreferencesScreenHeader dismiss="back" title="Export All My Data" />
      
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.body}>
          Export all your PokeSniper data including purchased cards, watchlist items, and metadata.
        </Text>

        <Text style={styles.sectionTitle}>Export Format</Text>

        <Pressable
          accessibilityLabel="Export as CSV"
          accessibilityRole="button"
          disabled={exporting}
          onPress={() => void exportData("csv")}
          style={[styles.exportButton, exporting && styles.exportButtonDisabled]}
        >
          <View style={styles.exportButtonContent}>
            <Text style={styles.exportButtonTitle}>CSV (Spreadsheet)</Text>
            <Text style={styles.exportButtonDetail}>
              Compatible with Excel, Google Sheets, and most apps
            </Text>
          </View>
          {exporting ? <ActivityIndicator color={colors.accent} /> : null}
        </Pressable>

        <Pressable
          accessibilityLabel="Export as JSON"
          accessibilityRole="button"
          disabled={exporting}
          onPress={() => void exportData("json")}
          style={[styles.exportButton, exporting && styles.exportButtonDisabled]}
        >
          <View style={styles.exportButtonContent}>
            <Text style={styles.exportButtonTitle}>JSON (Raw Data)</Text>
            <Text style={styles.exportButtonDetail}>
              Complete data with all fields and metadata
            </Text>
          </View>
          {exporting ? <ActivityIndicator color={colors.accent} /> : null}
        </Pressable>

        {success ? <Text style={styles.success}>{success}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.note}>
          This export includes all data stored locally and synced to your account. It does not include
          photos, which are automatically deleted after processing.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "800", marginTop: space.md },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  exportButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: space.md,
  },
  exportButtonDisabled: {
    opacity: 0.6,
  },
  exportButtonContent: {
    flex: 1,
    gap: 4,
  },
  exportButtonTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  exportButtonDetail: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  success: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  note: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: space.md,
  },
});
