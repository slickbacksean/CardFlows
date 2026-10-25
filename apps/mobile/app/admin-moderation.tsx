import { Stack, router } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { colors, radii, space } from "@/lib/theme";

interface Report {
  reportId: string;
  targetType: "post" | "comment" | "username";
  targetId: string;
  reason: string;
  note?: string;
  reporterUserId: string;
  createdAt: string;
}

export default function AdminModerationScreen() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadReports() {
    setLoading(true);
    try {
      // TODO: Replace with real API call
      // const response = await fetch(`${apiUrl()}/v1/community/admin/reports`, {
      //   headers: { Authorization: `Bearer ${peekSessionToken()}` },
      // });
      // const data = await response.json();
      // setReports(data.reports || []);
      setReports([]);
    } catch (caught) {
      Alert.alert("Error", "Failed to load reports");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      void loadReports();
    }, [])
  );

  async function resolveReport(reportId: string, action: string) {
    try {
      // TODO: Replace with real API call
      // const response = await fetch(`${apiUrl()}/v1/community/admin/reports/${reportId}/resolve`, {
      //   method: "POST",
      //   headers: {
      //     "Content-Type": "application/json",
      //     Authorization: `Bearer ${peekSessionToken()}`,
      //   },
      //   body: JSON.stringify({ action, notifyUser: true }),
      // });
      // if (!response.ok) throw new Error("Failed to resolve");
      
      Alert.alert("Resolved", `Report resolved with action: ${action}`);
      setReports(reports.filter((r) => r.reportId !== reportId));
    } catch (caught) {
      Alert.alert("Error", "Failed to resolve report");
    }
  }

  function handleReport(report: Report) {
    Alert.alert(
      `Report: ${report.targetType}`,
      `Reason: ${report.reason}\n${report.note ? `Note: ${report.note}` : ""}`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Dismiss", onPress: () => void resolveReport(report.reportId, "dismiss") },
        { text: "Warn", onPress: () => void resolveReport(report.reportId, "warn") },
        { text: "Remove", style: "destructive", onPress: () => void resolveReport(report.reportId, "remove") },
        { text: "Suspend", style: "destructive", onPress: () => void resolveReport(report.reportId, "suspend") },
        { text: "Ban", style: "destructive", onPress: () => void resolveReport(report.reportId, "ban") },
      ]
    );
  }

  function renderReport({ item }: { item: Report }) {
    return (
      <Pressable onPress={() => handleReport(item)} style={styles.report}>
        <View style={styles.reportHeader}>
          <Text style={styles.reportType}>{item.targetType.toUpperCase()}</Text>
          <Text style={styles.reportTime}>
            {new Date(item.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </Text>
        </View>
        <Text style={styles.reportReason}>Reason: {item.reason}</Text>
        {item.note ? <Text style={styles.reportNote}>{item.note}</Text> : null}
        <Text style={styles.reportId}>ID: {item.targetId}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Moderation Queue" }} />
      
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={reports}
          keyExtractor={(item) => item.reportId}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No pending reports</Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadReports()} />}
          renderItem={renderReport}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  emptyText: { color: colors.muted, fontSize: 15 },
  list: { padding: space.lg, gap: space.sm },
  report: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.lg,
    padding: space.md,
    gap: space.xs,
  },
  reportHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  reportType: { color: colors.accent, fontSize: 12, fontWeight: "800" },
  reportTime: { color: colors.muted, fontSize: 11 },
  reportReason: { color: colors.text, fontSize: 14, fontWeight: "700" },
  reportNote: { color: colors.muted, fontSize: 13, fontStyle: "italic" },
  reportId: { color: colors.muted, fontSize: 11, fontFamily: "monospace" },
});
