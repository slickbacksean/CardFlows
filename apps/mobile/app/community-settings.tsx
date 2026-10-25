import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { InlineError } from "@/components/ui/screen-state";
import { getCommunitySettings, updateCommunitySettings, getUsername, getBlockedUsers } from "@/lib/api";
import { colors, radii, space } from "@/lib/theme";

interface CommunitySettingsData {
  shareNew: boolean;
  showAs: "anonymous" | "username";
  sharePrice: boolean;
  rulesAccepted: boolean;
}

export default function CommunitySettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<CommunitySettingsData | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [blockedCount, setBlockedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const [settingsData, usernameData, blockedData] = await Promise.all([
        getCommunitySettings(),
        getUsername(),
        getBlockedUsers(),
      ]);

      if ("error" in settingsData) throw new Error(settingsData.error);
      if ("error" in usernameData) throw new Error(usernameData.error);
      if ("error" in blockedData) throw new Error(blockedData.error);

      setSettings(settingsData);
      setUsername("username" in usernameData ? usernameData.username : null);
      setBlockedCount("blocks" in blockedData ? blockedData.blocks.length : 0);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadSettings();
    }, [loadSettings])
  );

  async function updateSetting(key: keyof CommunitySettingsData, value: boolean | string) {
    if (!settings) return;

    setSaving(true);
    setError(null);

    try {
      await updateCommunitySettings({ [key]: value });
      setSettings({ ...settings, [key]: value });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to update setting");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <PreferencesScreenHeader dismiss="back" title="Community Settings" />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <PreferencesScreenHeader dismiss="back" title="Community Settings" />
      
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Sharing</Text>
        <Text style={styles.body}>
          Sharing is off by default. When on, new purchases appear in the Community feed.
        </Text>

        <View style={styles.settingRow}>
          <View style={styles.settingText}>
            <Text style={styles.settingLabel}>Share new purchases</Text>
            <Text style={styles.settingDetail}>Opt-in to share with the community</Text>
          </View>
          <Switch
            disabled={saving}
            onValueChange={(value) => void updateSetting("shareNew", value)}
            value={settings?.shareNew ?? false}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingText}>
            <Text style={styles.settingLabel}>Show as</Text>
            <Text style={styles.settingDetail}>
              {settings?.showAs === "username" && username
                ? `@${username}`
                : "Anonymous collector"}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={saving || !username}
            onPress={() => {
              const nextShowAs = settings?.showAs === "anonymous" ? "username" : "anonymous";
              void updateSetting("showAs", nextShowAs);
            }}
            style={styles.changeButton}
          >
            <Text style={styles.changeButtonText}>Change</Text>
          </Pressable>
        </View>

        {!username ? (
          <Text style={styles.note}>
            Set a username in your profile to post with your name
          </Text>
        ) : null}

        <View style={styles.settingRow}>
          <View style={styles.settingText}>
            <Text style={styles.settingLabel}>Share price paid</Text>
            <Text style={styles.settingDetail}>Show how much you paid for cards</Text>
          </View>
          <Switch
            disabled={saving}
            onValueChange={(value) => void updateSetting("sharePrice", value)}
            value={settings?.sharePrice ?? false}
          />
        </View>

        <Text style={styles.sectionTitle}>Blocked Users</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/blocked-users")}
          style={styles.blockedRow}
        >
          <Text style={styles.blockedLabel}>
            {blockedCount === 0 ? "No blocked users" : `${blockedCount} blocked user${blockedCount === 1 ? "" : "s"}`}
          </Text>
          <Text style={styles.blockedLink}>Manage →</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Community Rules</Text>
        <Text style={styles.body}>
          • Be respectful and kind{"\n"}
          • No harassment, hate speech, or bullying{"\n"}
          • No scams, fraud, or misleading posts{"\n"}
          • No spam or off-topic content{"\n"}
          • Follow all applicable laws
        </Text>

        <Text style={styles.note}>
          Violations may result in content removal, warnings, or account suspension.
        </Text>

        <InlineError message={error} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "800", marginTop: space.md },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  settingRow: {
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
  settingText: {
    flex: 1,
    gap: 4,
  },
  settingLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  settingDetail: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  changeButton: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  changeButtonText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: "700",
  },
  blockedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.lg,
    padding: space.md,
  },
  blockedLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  blockedLink: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: "700",
  },
  note: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontStyle: "italic",
  },
});
