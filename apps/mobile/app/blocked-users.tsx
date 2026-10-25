import { Stack, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { getBlockedUsers, unblockUser } from "@/lib/api";
import { colors, radii, space } from "@/lib/theme";

interface BlockedUser {
  userId: string;
  username: string | null;
  blockedAt: string;
}

export default function BlockedUsersScreen() {
  const [users, setUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unblocking, setUnblocking] = useState<string | null>(null);

  const loadBlocked = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await getBlockedUsers();
      if ("error" in result) {
        throw new Error(result.error);
      }
      setUsers(result.blocks || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load blocked users");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadBlocked();
    }, [loadBlocked])
  );

  async function handleUnblock(user: BlockedUser) {
    Alert.alert(
      "Unblock User",
      `Unblock ${user.username ? `@${user.username}` : "this user"}? You'll see their posts and comments again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unblock",
          style: "destructive",
          onPress: async () => {
            setUnblocking(user.userId);
            try {
              await unblockUser(user.userId);
              setUsers(users.filter((u) => u.userId !== user.userId));
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Failed to unblock");
            } finally {
              setUnblocking(null);
            }
          },
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <PreferencesScreenHeader dismiss="back" title="Blocked Users" />

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.empty}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : users.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No Blocked Users</Text>
          <Text style={styles.emptyBody}>
            When you block someone, they won&apos;t see your posts and you won&apos;t see theirs.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {users.map((user) => (
            <View key={user.userId} style={styles.userRow}>
              <View style={styles.userInfo}>
                <Text style={styles.username}>
                  {user.username ? `@${user.username}` : "Anonymous"}
                </Text>
                <Text style={styles.blockedDate}>
                  Blocked {new Date(user.blockedAt).toLocaleDateString()}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={`Unblock ${user.username || "user"}`}
                accessibilityRole="button"
                disabled={unblocking === user.userId}
                onPress={() => void handleUnblock(user)}
                style={styles.unblockButton}
              >
                {unblocking === user.userId ? (
                  <ActivityIndicator color={colors.danger} size="small" />
                ) : (
                  <Text style={styles.unblockText}>Unblock</Text>
                )}
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space.lg,
    gap: space.md,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  emptyBody: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 300,
  },
  error: {
    color: colors.danger,
    fontSize: 15,
    textAlign: "center",
  },
  content: {
    padding: space.lg,
    gap: space.sm,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.lg,
    padding: space.md,
    gap: space.md,
  },
  userInfo: {
    flex: 1,
    gap: 4,
  },
  username: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  blockedDate: {
    color: colors.muted,
    fontSize: 13,
  },
  unblockButton: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    minWidth: 80,
    alignItems: "center",
  },
  unblockText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: "700",
  },
});
