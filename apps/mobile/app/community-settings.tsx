import { Stack } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { colors, space } from "@/lib/theme";

export default function CommunitySettingsScreen() {
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <PreferencesScreenHeader dismiss="back" title="Community Settings" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Sharing</Text>
        <Text style={styles.body}>
          Sharing settings coming soon. Share new purchases, show as anonymous or username, share
          price paid.
        </Text>

        <Text style={styles.sectionTitle}>Blocked Users</Text>
        <Text style={styles.body}>Manage blocked users here.</Text>

        <Text style={styles.sectionTitle}>Rules</Text>
        <Text style={styles.body}>Community rules: Be respectful, no harassment, no scams.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "800", marginTop: space.md },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
});
