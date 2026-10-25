import { Stack, router } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { colors, radii, space } from "@/lib/theme";
import { apiUrl } from "@/lib/api";

interface DashboardStats {
  users: {
    totalUsers: number;
    newSignupsToday: number;
    newSignupsThisWeek: number;
    dailyActiveUsers: number;
    weeklyActiveUsers: number;
    monthlyActiveUsers: number;
  };
  scans: {
    totalScans: number;
    scansToday: number;
    scansThisWeek: number;
    recognitionSuccessRate: number;
    cardsightUsageThisMonth: number;
    cardsightMonthlyCap: number;
  };
  purchases: {
    totalPurchases: number;
    purchasesToday: number;
    purchasesThisWeek: number;
  };
  community: {
    totalPosts: number;
    postsToday: number;
    postsThisWeek: number;
    pendingReports: number;
  };
}

export default function AdminDashboardScreen() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadStats() {
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl()}/v1/admin/stats/dashboard`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to load stats");
      const data = await response.json() as DashboardStats;
      setStats(data);
    } catch (caught) {
      console.error("Failed to load admin stats:", caught);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      void loadStats();
    }, [])
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Admin Dashboard" }} />

      {loading && !stats ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadStats()} />}
        >
          <Text style={styles.heading}>Overview</Text>

          {stats && (
            <>
              <StatsCard title="Users">
                <StatRow label="Total Users" value={stats.users.totalUsers.toLocaleString()} />
                <StatRow label="New Today" value={stats.users.newSignupsToday.toLocaleString()} />
                <StatRow label="New This Week" value={stats.users.newSignupsThisWeek.toLocaleString()} />
                <StatRow label="Daily Active" value={stats.users.dailyActiveUsers.toLocaleString()} />
                <StatRow label="Weekly Active" value={stats.users.weeklyActiveUsers.toLocaleString()} />
                <StatRow label="Monthly Active" value={stats.users.monthlyActiveUsers.toLocaleString()} />
              </StatsCard>

              <StatsCard title="Scans">
                <StatRow label="Total Scans" value={stats.scans.totalScans.toLocaleString()} />
                <StatRow label="Today" value={stats.scans.scansToday.toLocaleString()} />
                <StatRow label="This Week" value={stats.scans.scansThisWeek.toLocaleString()} />
                <StatRow label="Recognition Rate" value={`${stats.scans.recognitionSuccessRate}%`} />
                <StatRow
                  label="CardSight Usage"
                  value={`${stats.scans.cardsightUsageThisMonth} / ${stats.scans.cardsightMonthlyCap}`}
                />
              </StatsCard>

              <StatsCard title="Purchases">
                <StatRow label="Total Purchases" value={stats.purchases.totalPurchases.toLocaleString()} />
                <StatRow label="Today" value={stats.purchases.purchasesToday.toLocaleString()} />
                <StatRow label="This Week" value={stats.purchases.purchasesThisWeek.toLocaleString()} />
              </StatsCard>

              <StatsCard title="Community">
                <StatRow label="Total Posts" value={stats.community.totalPosts.toLocaleString()} />
                <StatRow label="Today" value={stats.community.postsToday.toLocaleString()} />
                <StatRow label="This Week" value={stats.community.postsThisWeek.toLocaleString()} />
                <StatRow
                  label="Pending Reports"
                  value={stats.community.pendingReports.toLocaleString()}
                  alert={stats.community.pendingReports > 0}
                />
              </StatsCard>
            </>
          )}

          <Text style={styles.heading}>Management</Text>

          <ActionButton label="Creator Leaderboard" onPress={() => router.push("/admin-creators")} />
          <ActionButton label="Moderation Queue" onPress={() => router.push("/admin-moderation")} />
          <ActionButton label="Audit Log" onPress={() => router.push("/admin-audit-log")} />
        </ScrollView>
      )}
    </View>
  );
}

function StatsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function StatRow({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, alert && styles.statAlert]}>{value}</Text>
    </View>
  );
}

function ActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.actionButton}>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: space.lg, gap: space.sm },
  heading: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    marginTop: space.md,
    marginBottom: space.xs,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.lg,
    padding: space.md,
    gap: space.xs,
  },
  cardTitle: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginBottom: space.xs,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  statLabel: { color: colors.text, fontSize: 15 },
  statValue: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  statAlert: { color: colors.danger },
  actionButton: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.lg,
    padding: space.md,
  },
  actionLabel: { color: colors.text, fontSize: 16, fontWeight: "700" },
});
